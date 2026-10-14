import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { buildContentSecurityPolicy } from "../../shared/contentSecurityPolicy";
import { copyMissingMedia, createMediaStore } from "../mediaStore";
import { createNavigationPolicy, isSafeExternalUrl } from "../navigation";
import { createRendererProtocolHandler, resolveInside } from "../rendererProtocol";

const tempDirectory = createTempDirectories("loam-main-");

describe("navigation policy", () => {
  it("opens only web and mail links outside the app", () => {
    expect(isSafeExternalUrl("https://example.com/page")).toBe(true);
    expect(isSafeExternalUrl("mailto:someone@example.com")).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "loam-app://app/notes",
      "https://user:secret@example.com/",
      "not a url",
      `https://example.com/${"a".repeat(2050)}`,
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });

  it("treats only the app protocol host or the dev server origin as internal", () => {
    const packaged = createNavigationPolicy("loam-app://app/index.html");
    expect(packaged.isInternalUrl("loam-app://app/notes?noteId=1")).toBe(true);
    expect(packaged.isInternalUrl("loam-app://other/notes")).toBe(false);
    expect(packaged.isInternalUrl("https://example.com/")).toBe(false);

    const dev = createNavigationPolicy("http://127.0.0.1:5199/");
    expect(dev.isInternalUrl("http://127.0.0.1:5199/notes")).toBe(true);
    expect(dev.isInternalUrl("http://127.0.0.1:5200/notes")).toBe(false);
    expect(dev.isInternalUrl("http://localhost:5199/notes")).toBe(false);
  });
});

describe("renderer protocol", () => {
  it("resolves paths inside the renderer root only", () => {
    const root = "/srv/renderer";
    expect(resolveInside(root, "/assets/app.js")).toBe("/srv/renderer/assets/app.js");
    for (const path of ["/../secret", "/%2e%2e/secret", "/assets/%00.js", "/", "/%E0%A4%A"]) {
      expect(resolveInside(root, path)).toBeNull();
    }
  });

  it("serves bundled files with the CSP and falls back to the app shell for routes", async () => {
    const root = tempDirectory();
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(tempDirectory(), "outside.js"), "secret");
    const handle = createRendererProtocolHandler(root, "default-src 'self'");

    const script = await handle(new Request("loam-app://app/assets/app.js"));
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(script.headers.get("Content-Security-Policy")).toBe("default-src 'self'");

    const route = await handle(new Request("loam-app://app/notes"));
    expect(await route.text()).toBe("<html></html>");

    expect((await handle(new Request("loam-app://app/assets/missing.js"))).status).toBe(404);
    expect((await handle(new Request("loam-app://app/..%2Foutside.js"))).status).toBe(404);
    expect((await handle(new Request("loam-app://evil/assets/app.js"))).status).toBe(404);
  });
});

describe("media store", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it("saves supported images under random names and serves them back", async () => {
    const directory = tempDirectory();
    const media = createMediaStore(directory);
    const saved = await media.saveImage(png);

    expect(saved.path).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(saved.url).toBe(`loam-media://images/${saved.path}`);
    expect(readdirSync(directory)).toEqual([saved.path]);
    const response = await media.handleRequest(new Request(saved.url));
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("goes by an image's bytes, refusing other files, empty ones and oversized ones", async () => {
    const media = createMediaStore(tempDirectory());
    const encode = (text: string) => new TextEncoder().encode(text);
    await expect(
      media.saveImage(encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).rejects.toMatchObject({ status: 415 });
    await expect(media.saveImage(encode("<html><script></script></html>"))).rejects.toMatchObject({
      status: 415,
    });
    await expect(media.saveImage(new Uint8Array())).rejects.toMatchObject({ status: 400 });
    await expect(media.saveImage(new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      status: 413,
    });
  });

  it("serves only generated file names from the media host", async () => {
    const directory = tempDirectory();
    writeFileSync(join(directory, "notes.sqlite"), "database");
    const media = createMediaStore(directory);
    for (const url of [
      "loam-media://images/notes.sqlite",
      "loam-media://images/..%2Fnotes.sqlite",
      "loam-media://other/00000000-0000-4000-8000-000000000000.png",
      "loam-media://images/00000000-0000-4000-8000-000000000000.png",
      "loam-media://images/%E0",
    ]) {
      expect((await media.handleRequest(new Request(url))).status).toBe(404);
    }
  });

  it("copies tab files with the images, for sync and backups", async () => {
    const from = tempDirectory();
    const to = tempDirectory();
    const pdf = "00000000-0000-4000-8000-000000000000.pdf";
    writeFileSync(join(from, pdf), "%PDF-1.7");
    writeFileSync(join(from, "notes.sqlite"), "database");

    expect(await copyMissingMedia(from, to)).toBe(1);
    expect(readdirSync(to)).toEqual([pdf]);
  });

  it("refuses a malformed image reference instead of failing", async () => {
    const media = createMediaStore(tempDirectory());
    for (const reference of ["loam-media://images/%E0", "loam-media://images/%E0.png", "%E0"]) {
      await expect(media.readImage(reference)).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe("content security policy", () => {
  it("allows only bundled scripts in packaged builds", () => {
    const policy = buildContentSecurityPolicy();
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self';");
  });

  it("opens the dev server origin and its socket only in development", () => {
    const policy = buildContentSecurityPolicy({ devServerOrigin: "http://127.0.0.1:5199" });
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:5199 ws://127.0.0.1:5199");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  });
});
