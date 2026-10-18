import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGoogleAccount, type SecretBox } from "../google/googleAccount";
import { calendarRequestUrl } from "../google/googleCalendarProxy";
import {
  authorizationUrl,
  createPkce,
  endpointsAt,
  exchangeCode,
  GOOGLE_ENDPOINTS,
  GoogleAuthExpiredError,
  pkceChallenge,
  refreshAccessToken,
} from "../google/googleOAuth";

const endpoints = endpointsAt("https://google.test");

/** Seals by reversing and tagging, so a test can tell a sealed value from a plain one. */
const secrets: SecretBox = {
  canEncrypt: () => true,
  seal: (plain) => `sealed:${[...plain].reverse().join("")}`,
  open: (sealed) => (sealed.startsWith("sealed:") ? [...sealed.slice(7)].reverse().join("") : null),
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };

/**
 * A fake Google: the token endpoint, revocation and the Calendar API. `answer` decides each
 * request; every request is kept in `seen`.
 */
const fakeGoogle = (answer: (request: Seen) => Response | Promise<Response>) => {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : "",
    };
    seen.push(request);
    return answer(request);
  }) as typeof fetch;
  return { fetch: fetchImpl, seen };
};

describe("Google OAuth pieces", () => {
  it("makes a PKCE verifier Google accepts and its S256 challenge", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    expect(challenge).not.toBe(createPkce().challenge);
    // RFC 7636, appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("asks for offline access to calendar events and the calendar list, with the challenge and state", () => {
    const url = new URL(
      authorizationUrl({
        endpoints: GOOGLE_ENDPOINTS,
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:4567/",
        challenge: "challenge",
        state: "state-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client.apps.googleusercontent.com",
      redirect_uri: "http://127.0.0.1:4567/",
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "state-1",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("trades a code for tokens with the verifier and the client secret", async () => {
    const google = fakeGoogle(() =>
      json(200, { access_token: "at", expires_in: 3600, refresh_token: "rt", scope: "s" }),
    );
    const tokens = await exchangeCode({
      fetch: google.fetch,
      endpoints,
      clientId: "id",
      clientSecret: "secret",
      code: "code-1",
      verifier: "verifier-1",
      redirectUri: "http://127.0.0.1:1/",
      now: () => 1000,
    });
    expect(tokens).toEqual({
      accessToken: "at",
      expiresAt: 3_601_000,
      refreshToken: "rt",
      scope: "s",
    });
    expect(google.seen[0]!.url).toBe("https://google.test/token");
    expect(Object.fromEntries(new URLSearchParams(google.seen[0]!.body))).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      code_verifier: "verifier-1",
      client_id: "id",
      client_secret: "secret",
      redirect_uri: "http://127.0.0.1:1/",
    });
  });

  it("tells a refused refresh token (invalid_grant) from other failures", async () => {
    const refused = fakeGoogle(() =>
      json(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }),
    );
    await expect(
      refreshAccessToken({
        fetch: refused.fetch,
        endpoints,
        clientId: "id",
        clientSecret: null,
        refreshToken: "rt",
      }),
    ).rejects.toBeInstanceOf(GoogleAuthExpiredError);
    expect(new URLSearchParams(refused.seen[0]!.body).has("client_secret")).toBe(false);

    const down = fakeGoogle(() => json(500, { error: "internal_failure" }));
    await expect(
      refreshAccessToken({
        fetch: down.fetch,
        endpoints,
        clientId: "id",
        clientSecret: null,
        refreshToken: "rt",
      }),
    ).rejects.toThrow(/internal_failure/);
  });
});

describe("the Calendar API allowlist", () => {
  const root = GOOGLE_ENDPOINTS.calendar;

  it("builds Calendar API addresses with their query", () => {
    expect(
      calendarRequestUrl(root, {
        path: "/calendars/me%40gmail.com/events",
        query: { singleEvents: true, maxResults: 250, eventTypes: ["default", "focusTime"] },
      }).toString(),
    ).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/me%40gmail.com/events?singleEvents=true&maxResults=250&eventTypes=default&eventTypes=focusTime",
    );
  });

  it.each([
    "calendars/primary/events",
    "/../../oauth2/v2/userinfo",
    "/calendars/../../../drive/v3/files",
    "/calendars/%2e%2e/%2e%2e/gmail/v1/users/me/messages",
    "/calendars%2F..%2F..%2Fgmail",
    "//evil.example/calendar/v3/x",
    "/calendars\\..\\..\\gmail",
    "/calendars/primary/events?alt=media",
    "/calendars/primary/events#x",
    "/calendars/primary /events",
    "@evil.example/x",
  ])("refuses %s", (path) => {
    expect(() => calendarRequestUrl(root, { path })).toThrow(/not allowed|starts with|Only/);
  });
});

describe("the Google account", () => {
  let dataDirectory: string;
  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "loam-google-"));
  });
  afterEach(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
  });

  /** An account whose browser follows Google's redirect straight back with `code`. */
  const account = (
    answer: (request: Seen) => Response | Promise<Response>,
    browser: (url: URL) => Promise<void> = async (url) => {
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "code-1");
      back.searchParams.set("state", url.searchParams.get("state")!);
      await fetch(back);
    },
    now = () => 1_000_000,
  ) => {
    const google = fakeGoogle(answer);
    const statuses: string[] = [];
    const opened: URL[] = [];
    const created = createGoogleAccount({
      dataDirectory,
      endpoints,
      secrets,
      fetch: google.fetch,
      now,
      openBrowser: async (url) => {
        opened.push(new URL(url));
        await browser(new URL(url));
      },
      onStatus: (status) => statuses.push(status.state),
    });
    return { account: created, seen: google.seen, statuses, opened };
  };

  const signedInGoogle = (request: Seen) => {
    if (request.url === "https://google.test/token") {
      const form = new URLSearchParams(request.body);
      return form.get("grant_type") === "authorization_code"
        ? json(200, { access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" })
        : json(200, { access_token: "at-2", expires_in: 3600 });
    }
    if (request.url.endsWith("/users/me/calendarList/primary"))
      return json(200, { id: "me@gmail.com", primary: true });
    if (request.url === "https://google.test/revoke") return new Response("", { status: 200 });
    return json(200, { items: [] }, { etag: '"e1"' });
  };

  it("signs in through a page on this computer, keeping the tokens sealed and out of reach", async () => {
    const { account: google, seen, statuses, opened } = account(signedInGoogle);
    await google.configure({ clientId: "id.apps.googleusercontent.com", clientSecret: "shh" });
    const status = await google.signIn();

    expect(status).toMatchObject({
      state: "signed-in",
      email: "me@gmail.com",
      hasClientSecret: true,
    });
    expect(JSON.stringify(status)).not.toMatch(/rt-1|at-1|shh/);
    expect(statuses).toContain("signing-in");
    const redirect = opened[0]!.searchParams.get("redirect_uri")!;
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const exchange = new URLSearchParams(seen.find((r) => r.url.endsWith("/token"))!.body);
    expect(pkceChallenge(exchange.get("code_verifier")!)).toBe(
      opened[0]!.searchParams.get("code_challenge"),
    );
    expect(exchange.get("redirect_uri")).toBe(redirect);

    const saved = await readFile(join(dataDirectory, "google.json"), "utf8");
    expect(saved).not.toMatch(/"rt-1"|"shh"/);
    expect(JSON.parse(saved)).toMatchObject({
      clientId: "id.apps.googleusercontent.com",
      refreshToken: secrets.seal("rt-1"),
      clientSecret: secrets.seal("shh"),
    });
    // The loopback page is closed once it answered.
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("ignores an answer that doesn't carry this sign-in's state", async () => {
    const { account: google } = account(signedInGoogle, async (url) => {
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "stolen");
      back.searchParams.set("state", "someone-else");
      const response = await fetch(back);
      expect(response.status).toBe(404);
      // Then the real answer comes.
      back.searchParams.set("code", "code-1");
      back.searchParams.set("state", url.searchParams.get("state")!);
      await fetch(back);
    });
    await google.configure({ clientId: "id" });
    await expect(google.signIn()).resolves.toMatchObject({ state: "signed-in" });
  });

  it("reports a cancelled consent and stays signed out", async () => {
    const { account: google } = account(signedInGoogle, async (url) => {
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("state", url.searchParams.get("state")!);
      await fetch(back);
    });
    await google.configure({ clientId: "id" });
    await expect(google.signIn()).resolves.toMatchObject({
      state: "signed-out",
      error: "Google sign-in was cancelled.",
    });
  });

  it("adds the bearer token to Calendar requests, refreshing it when it runs out", async () => {
    let time = 1_000_000;
    const { account: google, seen } = account(signedInGoogle, undefined, () => time);
    await google.configure({ clientId: "id" });
    await google.signIn();

    await google.calendar({
      path: "/users/me/calendarList",
      headers: { "If-Match": '"e0"', Authorization: "Bearer stolen", Cookie: "x" },
    });
    const first = seen.at(-1)!;
    expect(first.url).toBe("https://google.test/calendar/v3/users/me/calendarList");
    expect(first.headers).toMatchObject({ authorization: "Bearer at-1", "if-match": '"e0"' });
    expect(first.headers.cookie).toBeUndefined();

    time += 3600_000;
    await google.calendar({ path: "/users/me/calendarList" });
    const refresh = seen.at(-2)!;
    expect(new URLSearchParams(refresh.body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(refresh.body).get("refresh_token")).toBe("rt-1");
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer at-2");
  });

  it("refreshes once on a 401 and tries again", async () => {
    let rejected = false;
    const { account: google, seen } = account((request) => {
      if (request.url.endsWith("/events") && !rejected) {
        rejected = true;
        return json(401, { error: { code: 401 } });
      }
      return signedInGoogle(request);
    });
    await google.configure({ clientId: "id" });
    await google.signIn();
    const response = await google.calendar({ path: "/calendars/primary/events" });
    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe('"e1"');
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer at-2");
  });

  it("marks the account signed out when Google refuses the refresh token, with a hint about Testing", async () => {
    let time = 1_000_000;
    let refuse = false;
    const { account: google, statuses } = account(
      (request) =>
        refuse && request.url.endsWith("/token")
          ? json(400, { error: "invalid_grant" })
          : signedInGoogle(request),
      undefined,
      () => time,
    );
    await google.configure({ clientId: "id" });
    await google.signIn();
    refuse = true;
    time += 7 * 86_400_000;

    await expect(google.calendar({ path: "/users/me/calendarList" })).rejects.toMatchObject({
      code: "GOOGLE_SIGNED_OUT",
    });
    const status = await google.status();
    expect(status.state).toBe("expired");
    expect(status.error).toMatch(/publish it to Production/);
    expect(statuses.at(-1)).toBe("expired");
    expect(
      JSON.parse(await readFile(join(dataDirectory, "google.json"), "utf8")).refreshToken,
    ).toBeNull();
  });

  it("revokes and forgets the sign-in on sign out, keeping the client", async () => {
    const { account: google, seen } = account(signedInGoogle);
    await google.configure({ clientId: "id", clientSecret: "shh" });
    await google.signIn();
    await expect(google.signOut()).resolves.toMatchObject({
      state: "signed-out",
      email: null,
      clientId: "id",
      hasClientSecret: true,
    });
    const revoke = seen.find((request) => request.url === "https://google.test/revoke")!;
    expect(new URLSearchParams(revoke.body).get("token")).toBe("rt-1");
    await expect(google.calendar({ path: "/users/me/calendarList" })).rejects.toMatchObject({
      code: "GOOGLE_SIGNED_OUT",
    });
  });

  it("ends the sign-in when the client changes, and won't keep secrets it can't encrypt", async () => {
    const { account: google } = account(signedInGoogle);
    await google.configure({ clientId: "id" });
    await google.signIn();
    await expect(google.configure({ clientId: "other" })).resolves.toMatchObject({
      state: "signed-out",
      clientId: "other",
    });

    const locked = createGoogleAccount({
      dataDirectory,
      endpoints,
      secrets: { ...secrets, canEncrypt: () => false },
      openBrowser: vi.fn(),
      onStatus: () => undefined,
    });
    await expect(locked.configure({ clientId: "id", clientSecret: "shh" })).rejects.toThrow(
      /can't encrypt/,
    );
  });
});
