import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type {
  BridgeGoogleStatus,
  GoogleAccountState,
  PluginGoogleCalendarRequest,
  PluginGoogleCalendarResponse,
} from "@loam/shared/google/googleAccount";
import { StoreError } from "@loam/storage/storeError";

import { readJsonFile, writeJsonFile } from "../jsonFiles";
import { sendCalendarRequest } from "./googleCalendarProxy";
import { startLoopback } from "./googleLoopback";
import {
  authorizationUrl,
  createPkce,
  createState,
  exchangeCode,
  GoogleAuthExpiredError,
  refreshAccessToken,
  revokeToken,
  type GoogleEndpoints,
} from "./googleOAuth";

/*
 * The Google account plugins granted google:calendar reach the Calendar API through. It keeps
 * the OAuth client the user created, the refresh token (both sealed with the operating
 * system's keychain, in google.json beside the notes but outside notes, backups and sync), and
 * the access token in memory. Neither token ever leaves the main process.
 */

/** Seals and opens secrets; Electron's safeStorage in the app, a stand-in in tests. */
export type SecretBox = {
  canEncrypt: () => boolean;
  seal: (plain: string) => string;
  open: (sealed: string) => string | null;
};

const fileSchema = z.object({
  clientId: z.string().max(500).nullable().catch(null),
  clientSecret: z.string().max(20_000).nullable().catch(null),
  refreshToken: z.string().max(20_000).nullable().catch(null),
  email: z.string().max(500).nullable().catch(null),
  expired: z.boolean().catch(false),
});
type GoogleFile = z.infer<typeof fileSchema>;

const EMPTY: GoogleFile = {
  clientId: null,
  clientSecret: null,
  refreshToken: null,
  email: null,
  expired: false,
};

/** Refresh a little early, so a token never expires on its way to Google. */
const EXPIRY_MARGIN_MS = 60_000;

const EXPIRED_MESSAGE =
  "Google signed Loam out. Sign in again. If this happens every week, your Google Cloud app is in Testing: publish it to Production to keep the sign-in.";

const signedOut = () =>
  new StoreError("Sign in to Google in Settings, Plugins.", "GOOGLE_SIGNED_OUT", 401);

const describe = (error: unknown) =>
  error instanceof Error ? error.message : "Signing in to Google failed.";

export const createGoogleAccount = ({
  dataDirectory,
  endpoints,
  secrets,
  openBrowser,
  onStatus,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: {
  dataDirectory: string;
  endpoints: GoogleEndpoints;
  secrets: SecretBox;
  /** Opens Google's consent page in the system browser. */
  openBrowser: (url: string) => Promise<void>;
  onStatus: (status: BridgeGoogleStatus) => void;
  fetch?: typeof fetch;
  now?: () => number;
}) => {
  const path = join(dataDirectory, "google.json");
  let file: GoogleFile | null = null;
  let error: string | null = null;
  let signingIn: { close: () => void } | null = null;
  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;

  const read = async () => {
    if (file) return file;
    try {
      file = fileSchema.parse((await readJsonFile(path)) ?? EMPTY);
    } catch {
      file = EMPTY;
    }
    return file;
  };
  const write = async (next: GoogleFile) => {
    file = next;
    await mkdir(dataDirectory, { recursive: true });
    await writeJsonFile(path, next, { private: true });
  };

  const stateOf = (current: GoogleFile): GoogleAccountState =>
    signingIn
      ? "signing-in"
      : current.refreshToken
        ? "signed-in"
        : current.expired
          ? "expired"
          : "signed-out";

  const status = async (): Promise<BridgeGoogleStatus> => {
    const current = await read();
    return {
      clientId: current.clientId,
      hasClientSecret: Boolean(current.clientSecret),
      state: stateOf(current),
      email: current.email,
      error,
      canEncrypt: secrets.canEncrypt(),
    };
  };
  const announce = async () => onStatus(await status());

  const clientSecret = (current: GoogleFile) =>
    current.clientSecret ? secrets.open(current.clientSecret) : null;

  /** Forgets the sign-in; `expired` says Google ended it rather than the user. */
  const dropTokens = async (expired: boolean) => {
    access = null;
    const current = await read();
    await write({ ...current, refreshToken: null, email: expired ? current.email : null, expired });
  };

  const accessToken = async (force = false): Promise<string> => {
    if (!force && access && access.expiresAt - EXPIRY_MARGIN_MS > now()) return access.token;
    refreshing ??= (async () => {
      const current = await read();
      const refreshToken = current.refreshToken ? secrets.open(current.refreshToken) : null;
      if (!current.clientId || !refreshToken) throw signedOut();
      try {
        const tokens = await refreshAccessToken({
          fetch: fetchImpl,
          endpoints,
          clientId: current.clientId,
          clientSecret: clientSecret(current),
          refreshToken,
          now,
        });
        access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
        return tokens.accessToken;
      } catch (failure) {
        if (failure instanceof GoogleAuthExpiredError) {
          error = EXPIRED_MESSAGE;
          await dropTokens(true);
          void announce();
          throw signedOut();
        }
        throw new StoreError(describe(failure), "GOOGLE_UNAVAILABLE", 503);
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  /** The account's address: its primary calendar's id, which the granted scopes can read. */
  const readEmail = async (token: string) => {
    try {
      const response = await sendCalendarRequest({
        fetch: fetchImpl,
        calendarRoot: endpoints.calendar,
        request: { path: "/users/me/calendarList/primary" },
        accessToken: token,
      });
      const id = (JSON.parse(response.body) as { id?: unknown }).id;
      return response.status === 200 && typeof id === "string" && id.includes("@") ? id : null;
    } catch {
      return null;
    }
  };

  return {
    status,

    /**
     * Saves the OAuth client to sign in with. A secret of undefined keeps the saved one and
     * null removes it. Another client ID ends the sign-in, whose tokens belong to the old one.
     */
    async configure({
      clientId,
      clientSecret: secret,
    }: {
      clientId: string;
      clientSecret?: string | null;
    }) {
      const current = await read();
      const id = clientId.trim() || null;
      const trimmedSecret = secret?.trim();
      if (trimmedSecret && !secrets.canEncrypt())
        throw new StoreError(
          "This computer can't encrypt the client secret, so Loam can't keep it.",
          "UNAVAILABLE",
          503,
        );
      const changedClient = id !== current.clientId;
      if (changedClient && current.refreshToken) {
        const token = secrets.open(current.refreshToken);
        if (token) void revokeToken({ fetch: fetchImpl, endpoints, token });
      }
      await write({
        ...current,
        clientId: id,
        clientSecret:
          secret === undefined
            ? current.clientSecret
            : trimmedSecret
              ? secrets.seal(trimmedSecret)
              : null,
        ...(changedClient && { refreshToken: null, email: null, expired: false }),
      });
      if (changedClient) access = null;
      error = null;
      await announce();
      return status();
    },

    /**
     * Opens Google's consent page in the browser and waits for it to come back to a page on
     * this computer, then trades the code for tokens. One sign-in at a time: a new one ends
     * the one before.
     */
    async signIn(): Promise<BridgeGoogleStatus> {
      const current = await read();
      if (!current.clientId)
        throw new StoreError("Enter your Google OAuth client ID first.", "VALIDATION_ERROR", 400);
      if (!secrets.canEncrypt())
        throw new StoreError(
          "This computer can't encrypt the sign-in, so Loam can't keep it.",
          "UNAVAILABLE",
          503,
        );
      signingIn?.close();
      const pkce = createPkce();
      const state = createState();
      const loopback = await startLoopback({ state });
      const attempt = { close: loopback.close };
      signingIn = attempt;
      error = null;
      await announce();
      try {
        await openBrowser(
          authorizationUrl({
            endpoints,
            clientId: current.clientId,
            redirectUri: loopback.redirectUri,
            challenge: pkce.challenge,
            state,
          }),
        );
        const answer = await loopback.answer;
        if ("error" in answer)
          throw new Error(
            answer.error === "access_denied"
              ? "Google sign-in was cancelled."
              : `Google sign-in failed (${answer.error}).`,
          );
        const tokens = await exchangeCode({
          fetch: fetchImpl,
          endpoints,
          clientId: current.clientId,
          clientSecret: clientSecret(current),
          code: answer.code,
          verifier: pkce.verifier,
          redirectUri: loopback.redirectUri,
          now,
        });
        if (!tokens.refreshToken) throw new Error("Google sent no refresh token. Try again.");
        access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
        const email = await readEmail(tokens.accessToken);
        await write({
          ...(await read()),
          refreshToken: secrets.seal(tokens.refreshToken),
          email,
          expired: false,
        });
      } catch (failure) {
        // A newer sign-in replaced this one; it reports for itself.
        if (signingIn === attempt) error = describe(failure);
      } finally {
        loopback.close();
        if (signingIn === attempt) {
          signingIn = null;
          await announce();
        }
      }
      return status();
    },

    cancelSignIn() {
      signingIn?.close();
    },

    /** Revokes the grant at Google and forgets it here; the client stays for next time. */
    async signOut() {
      signingIn?.close();
      const current = await read();
      const token = current.refreshToken ? secrets.open(current.refreshToken) : null;
      await dropTokens(false);
      error = null;
      if (token) await revokeToken({ fetch: fetchImpl, endpoints, token });
      await announce();
      return status();
    },

    /**
     * Sends a plugin's Calendar API request with the access token. A 401 refreshes the token
     * once and tries again, as Google can end an access token early.
     */
    async calendar(request: PluginGoogleCalendarRequest): Promise<PluginGoogleCalendarResponse> {
      const send = async (token: string) =>
        sendCalendarRequest({
          fetch: fetchImpl,
          calendarRoot: endpoints.calendar,
          request,
          accessToken: token,
        });
      const response = await send(await accessToken());
      if (response.status !== 401) return response;
      return send(await accessToken(true));
    },

    close() {
      signingIn?.close();
    },
  };
};

export type GoogleAccount = ReturnType<typeof createGoogleAccount>;
