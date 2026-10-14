/**
 * The renderer runs only bundled code. Media comes from the local `loam-media:`
 * protocol. Frames are https pages: YouTube for note videos, and the pages
 * embed tabs show, each cross-origin and sandboxed by its tab.
 */
export const buildContentSecurityPolicy = ({
  devServerOrigin,
}: { devServerOrigin?: string } = {}) =>
  [
    "default-src 'self'",
    // Vite's dev preamble is an inline module; packaged builds allow bundled files only.
    devServerOrigin ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: loam-media: https:",
    "media-src 'self' blob: loam-media:",
    "font-src 'self' data:",
    devServerOrigin
      ? `connect-src 'self' ${devServerOrigin} ${devServerOrigin.replace(/^http/, "ws")}`
      : "connect-src 'self'",
    "frame-src https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

/**
 * The policy of the worker each plugin runs in. It may load the plugin's module, which the
 * window hands it as a blob, and nothing else: no network, no frames, no other workers. A
 * plugin reaches notes and the network only through the messages the window answers.
 */
export const PLUGIN_WORKER_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' blob:",
  "connect-src 'none'",
  "worker-src 'none'",
].join("; ");

/** The built plugin worker, as Vite names it in the renderer's assets. */
export const isPluginWorkerAsset = (pathname: string) =>
  /^\/?assets\/pluginWorker-[\w-]+\.js$/.test(pathname);
