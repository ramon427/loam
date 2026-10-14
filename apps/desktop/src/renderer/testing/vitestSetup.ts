import { afterEach } from "vitest";

// Window tests run in jsdom; storage and main-process tests run in Node and render nothing.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);

  // jsdom has no ResizeObserver, and Radix and the tab strip measure with one.
  // A test that needs resize callbacks stubs its own.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
