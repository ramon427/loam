/*
 * The Google account Loam signs in to for plugins granted google:calendar. The main process
 * holds the tokens and the client secret; the window and plugins only ever see this.
 */

export type GoogleAccountState = "signed-out" | "signing-in" | "signed-in" | "expired";

/** What Settings shows about the Google account. */
export type BridgeGoogleStatus = {
  /** The Google Cloud OAuth client (Desktop app) to sign in with. */
  clientId: string | null;
  hasClientSecret: boolean;
  /** `expired`: Google stopped accepting the sign-in, so it has to be done again. */
  state: GoogleAccountState;
  /** The account's address, read from its primary calendar, once signed in. */
  email: string | null;
  /** Why the last sign-in or request failed, in words for the user. */
  error: string | null;
  /** Whether this computer can encrypt the tokens; without it, Loam can't sign in. */
  canEncrypt: boolean;
};

/** What a plugin learns from `$.google.status()`. */
export type PluginGoogleStatus = Pick<BridgeGoogleStatus, "state" | "email">;

/** A Calendar API request a plugin sends through the main process. */
export type PluginGoogleCalendarRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | (string | number)[]>;
  body?: string;
  headers?: Record<string, string>;
};

export type PluginGoogleCalendarResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
