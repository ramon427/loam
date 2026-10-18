import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * The one-time page on this computer Google's consent screen sends the browser back to
 * (http://127.0.0.1:<random port>/), as Google asks desktop apps to do. It answers one request
 * that carries this sign-in's `state`, then closes.
 */

const page = (title: string, text: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; background: Canvas; color: CanvasText; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .7; line-height: 1.5; }
</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

const SIGNED_IN_PAGE = page(
  "You're signed in to Loam",
  "You can close this tab and go back to Loam.",
);
const DENIED_PAGE = page("Loam wasn't connected", "You can close this tab and try again in Loam.");

type LoopbackAnswer = { code: string } | { error: string };

type Loopback = {
  /** `http://127.0.0.1:<port>/`, the redirect URI Google sends the browser back to. */
  redirectUri: string;
  /** The browser's answer: a code, or Google's error (such as `access_denied`). */
  answer: Promise<LoopbackAnswer>;
  close: () => void;
};

/** Listens on 127.0.0.1 on a free port until the browser comes back with `state`. */
export const startLoopback = async ({
  state,
  timeoutMs = 5 * 60_000,
}: {
  state: string;
  timeoutMs?: number;
}): Promise<Loopback> => {
  let settle: (answer: LoopbackAnswer) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const answer = new Promise<LoopbackAnswer>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let done = false;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // Browsers also ask for /favicon.ico; only the redirect with this sign-in's state counts.
    if (done || url.pathname !== "/" || url.searchParams.get("state") !== state) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    done = true;
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      })
      .end(code ? SIGNED_IN_PAGE : DENIED_PAGE);
    settle(code ? { code } : { error: error ?? "no_code" });
    close();
  });

  const timer = setTimeout(() => {
    fail(new Error("Signing in took too long. Try again."));
    close();
  }, timeoutMs);
  const close = () => {
    clearTimeout(timer);
    if (!done) {
      done = true;
      fail(new Error("Signing in was cancelled."));
    }
    server.close();
    server.closeAllConnections();
  };
  answer.catch(() => undefined);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://127.0.0.1:${port}/`, answer, close };
};
