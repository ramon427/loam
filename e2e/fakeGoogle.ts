import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createFakeGoogleCalendar,
  type FakeGoogleCalendar,
} from "../apps/desktop/plugins/google-calendar/src/testing/fakeGoogleCalendar";

/*
 * Google's sign-in and Calendar API on a local port, for the end-to-end tests: the app is
 * pointed at it with LOAM_E2E_GOOGLE_URL, so nothing reaches the network. Sign-in answers at
 * once with a code (checking PKCE when the code is exchanged), and the Calendar API is the
 * in-memory fake the plugin's unit tests use.
 */

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => resolve(body));
  });

const base64url = (buffer: Buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const startFakeGoogle = async () => {
  let calendar: FakeGoogleCalendar = createFakeGoogleCalendar();
  const codes = new Map<string, string>();
  const accessTokens = new Set<string>();
  let issued = 0;
  const revoked: string[] = [];

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await read(request);
      const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(typeof value === "string" ? value : JSON.stringify(value));
      };

      if (url.pathname === "/o/oauth2/v2/auth") {
        const code = `code-${(issued += 1)}`;
        codes.set(code, url.searchParams.get("code_challenge") ?? "");
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.toString() });
        response.end();
        return;
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          const challenge = codes.get(form.get("code") ?? "");
          const verifier = form.get("code_verifier") ?? "";
          if (!challenge || base64url(createHash("sha256").update(verifier).digest()) !== challenge)
            return send(400, { error: "invalid_grant" });
          codes.delete(form.get("code")!);
        } else if (form.get("refresh_token") !== "refresh-1")
          return send(400, { error: "invalid_grant" });
        const token = `access-${(issued += 1)}`;
        accessTokens.add(token);
        return send(200, {
          access_token: token,
          expires_in: 3600,
          token_type: "Bearer",
          ...(form.get("grant_type") === "authorization_code" && { refresh_token: "refresh-1" }),
        });
      }
      if (url.pathname === "/revoke") {
        revoked.push(new URLSearchParams(body).get("token") ?? "");
        return send(200, "");
      }
      if (url.pathname.startsWith("/calendar/v3/")) {
        const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!accessTokens.has(token))
          return send(401, { error: { code: 401, message: "Invalid Credentials" } });
        const query: Record<string, string | string[]> = {};
        for (const key of new Set(url.searchParams.keys())) {
          const values = url.searchParams.getAll(key);
          query[key] = values.length > 1 ? values : values[0]!;
        }
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers))
          if (typeof value === "string") headers[name] = value;
        const answer = calendar.handle({
          method: request.method ?? "GET",
          path: url.pathname.slice("/calendar/v3".length),
          query,
          headers,
          body,
        });
        response.writeHead(answer.status, answer.headers);
        response.end(answer.body);
        return;
      }
      send(404, { error: "not found" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    /** The Calendar API the app talks to now. */
    get calendar() {
      return calendar;
    },
    /** Starts afresh with an empty calendar, for the next test. */
    reset() {
      calendar = createFakeGoogleCalendar();
      revoked.length = 0;
    },
    revoked,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
