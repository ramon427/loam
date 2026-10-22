import { afterEach, describe, expect, it } from "vitest";

import { configureNotesHost, configuredNotesHost } from "../../host/notesHost";
import { mediaSrc, toMediaPath } from "../mediaSrc";

describe("toMediaPath", () => {
  it("keeps a stored path", () => {
    expect(toMediaPath("3f1c.png")).toBe("3f1c.png");
    expect(toMediaPath("  nested/3f1c.png ")).toBe("nested/3f1c.png");
  });

  it("reads the path back out of a local media URL", () => {
    expect(toMediaPath("loam-media://images/3f1c.png")).toBe("3f1c.png");
    expect(toMediaPath("loam-media://images/my%20photo.png")).toBe("my photo.png");
  });

  it("rejects references that don't point into the media folder", () => {
    for (const ref of [
      "",
      "https://example.com/a.png",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "/absolute/a.png",
      "//host/a.png",
      "../outside.png",
      "a/../../b.png",
      "a\\b.png",
      "loam-media://other/a.png",
      "loam-media://images/..%2Fsecret",
    ]) {
      expect(toMediaPath(ref), ref).toBeNull();
    }
  });
});

describe("mediaSrc", () => {
  it("serves stored paths and media URLs from the media protocol", () => {
    expect(mediaSrc("3f1c.png")).toBe("loam-media://images/3f1c.png");
    expect(mediaSrc("loam-media://images/3f1c.png")).toBe("loam-media://images/3f1c.png");
    expect(mediaSrc("my photo.png")).toBe("loam-media://images/my%20photo.png");
  });

  it("passes https URLs through and drops everything else", () => {
    expect(mediaSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(mediaSrc("http://example.com/a.png")).toBeNull();
    expect(mediaSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(mediaSrc("blob:loam-app://renderer/123")).toBeNull();
    expect(mediaSrc("")).toBeNull();
  });

  describe("in a host with its own image addresses", () => {
    const loamHost = configuredNotesHost();
    afterEach(() => {
      if (loamHost) configureNotesHost(loamHost);
    });

    it("reads them through the host", () => {
      configureNotesHost({
        ...loamHost!,
        mediaPath: (ref) => (ref.startsWith("app-file://") ? ref : null),
        mediaUrl: (path) => (path.startsWith("app-file://") ? path : `app-file://images/${path}`),
      });
      expect(mediaSrc("app-file://images/a.png")).toBe("app-file://images/a.png");
      expect(mediaSrc("3f1c.png")).toBe("app-file://images/3f1c.png");
      expect(mediaSrc("file:///etc/passwd")).toBeNull();
    });
  });
});
