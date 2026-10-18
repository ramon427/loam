import { createHash, randomBytes } from "node:crypto";

/*
 * The pieces of Google's OAuth 2.0 flow for desktop apps
 * (https://developers.google.com/identity/protocols/oauth2/native-app): a PKCE pair, the
 * address the browser opens, and the token endpoint's code exchange, refresh and revocation.
 * Each takes the endpoints it talks to, so tests point them at a fake server.
 */

/** Where Google's endpoints are; tests replace every origin with a local fake. */
export type GoogleEndpoints = {
  auth: string;
  token: string;
  revoke: string;
  /** The Calendar API's root, `https://www.googleapis.com/calendar/v3`. */
  calendar: string;
};

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  calendar: "https://www.googleapis.com/calendar/v3",
};

/** The same endpoints on another origin, for a fake Google in tests. */
export const endpointsAt = (origin: string): GoogleEndpoints => {
  const base = origin.replace(/\/+$/, "");
  return {
    auth: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revoke: `${base}/revoke`,
    calendar: `${base}/calendar/v3`,
  };
};

/**
 * Events in every calendar (read and write), and the list of calendars with their names and
 * colors. Neither reaches mail, contacts or calendar settings.
 */
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

/** A PKCE verifier (43 characters of the unreserved set) and its S256 challenge. */
export const createPkce = () => {
  const verifier = base64Url(randomBytes(32));
  return { verifier, challenge: pkceChallenge(verifier) };
};

export const pkceChallenge = (verifier: string) =>
  base64Url(createHash("sha256").update(verifier).digest());

/** An unguessable value tying the browser's answer to this sign-in. */
export const createState = () => base64Url(randomBytes(24));

/** The consent page's address for this sign-in. */
export const authorizationUrl = ({
  endpoints,
  clientId,
  redirectUri,
  challenge,
  state,
}: {
  endpoints: GoogleEndpoints;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}) => {
  const url = new URL(endpoints.auth);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    // A refresh token on every consent, so signing in again replaces a lost one.
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
};

type GoogleTokens = {
  accessToken: string;
  /** When the access token stops working, in milliseconds since 1970. */
  expiresAt: number;
  /** Only on a code exchange; a refresh keeps the one there is. */
  refreshToken?: string;
  scope: string;
};

/** Google refused the refresh token: revoked, expired (7 days in Testing), or the client changed. */
export class GoogleAuthExpiredError extends Error {
  constructor(readonly reason: string) {
    super("Google signed Loam out.");
    this.name = "GoogleAuthExpiredError";
  }
}

/** Any other failure of the token endpoint, with Google's own words when it gave any. */
class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

type Fetch = typeof fetch;

const TOKEN_TIMEOUT_MS = 30_000;

const postForm = async (fetchImpl: Fetch, url: string, form: Record<string, string>) => {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Revocation answers with an empty body.
  }
  return { status: response.status, body };
};

const readTokens = (body: Record<string, unknown>, now: number): GoogleTokens => {
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new GoogleOAuthError("Google sent no access token.", 502);
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    accessToken: body.access_token,
    expiresAt: now + expiresIn * 1000,
    ...(typeof body.refresh_token === "string" &&
      body.refresh_token && { refreshToken: body.refresh_token }),
    scope: typeof body.scope === "string" ? body.scope : "",
  };
};

const failure = (status: number, body: Record<string, unknown>) => {
  const error = typeof body.error === "string" ? body.error : "";
  if (error === "invalid_grant") return new GoogleAuthExpiredError(error);
  const description =
    typeof body.error_description === "string" ? body.error_description : error || "";
  return new GoogleOAuthError(
    description ? `Google said: ${description}` : `Google answered ${status}.`,
    status,
  );
};

/**
 * Trades the code the browser brought back for tokens. Google treats a desktop client's
 * secret as optional but accepts it, and older clients need it, so it goes along when known.
 */
export const exchangeCode = async ({
  fetch: fetchImpl = fetch,
  endpoints,
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri,
  now = Date.now,
}: {
  fetch?: Fetch;
  endpoints: GoogleEndpoints;
  clientId: string;
  clientSecret: string | null;
  code: string;
  verifier: string;
  redirectUri: string;
  now?: () => number;
}) => {
  const { status, body } = await postForm(fetchImpl, endpoints.token, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    ...(clientSecret && { client_secret: clientSecret }),
    redirect_uri: redirectUri,
  });
  if (status !== 200) throw failure(status, body);
  return readTokens(body, now());
};

/** A new access token from the refresh token; `invalid_grant` means signing in again. */
export const refreshAccessToken = async ({
  fetch: fetchImpl = fetch,
  endpoints,
  clientId,
  clientSecret,
  refreshToken,
  now = Date.now,
}: {
  fetch?: Fetch;
  endpoints: GoogleEndpoints;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  now?: () => number;
}) => {
  const { status, body } = await postForm(fetchImpl, endpoints.token, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...(clientSecret && { client_secret: clientSecret }),
  });
  if (status !== 200) throw failure(status, body);
  return readTokens(body, now());
};

/** Asks Google to forget the grant; signing out goes ahead whatever it answers. */
export const revokeToken = async ({
  fetch: fetchImpl = fetch,
  endpoints,
  token,
}: {
  fetch?: Fetch;
  endpoints: GoogleEndpoints;
  token: string;
}) => {
  try {
    const { status } = await postForm(fetchImpl, endpoints.revoke, { token });
    return status === 200;
  } catch {
    return false;
  }
};
