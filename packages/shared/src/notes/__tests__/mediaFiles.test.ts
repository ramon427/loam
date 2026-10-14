import { describe, expect, it } from "vitest";

import { buildMediaUrl, readLocalMediaImagePath, readMediaFileName } from "../mediaFiles";

const NAME = "11111111-1111-4111-8111-111111111111.png";

describe("media files", () => {
  it("reads back the file name a media URL was built from", () => {
    const url = buildMediaUrl(NAME);
    expect(url).toBe(`loam-media://images/${NAME}`);
    expect(readMediaFileName(url)).toBe(NAME);
    expect(readMediaFileName(` ${NAME} `)).toBe(NAME);
    expect(readLocalMediaImagePath(buildMediaUrl("my photo.png"))).toBe("my photo.png");
  });

  it("names only files the media folder saved", () => {
    for (const reference of [
      "photo.png",
      "11111111-1111-4111-8111-111111111111.svg",
      "11111111-1111-4111-8111-111111111111.PNG",
      "loam-media://other/11111111-1111-4111-8111-111111111111.png",
      "loam-media://images/..%2Fnotes.sqlite",
      "https://example.com/11111111-1111-4111-8111-111111111111.png",
    ]) {
      expect(readMediaFileName(reference), reference).toBeNull();
    }
  });

  it("treats a malformed media URL as no image", () => {
    expect(readLocalMediaImagePath("loam-media://images/%E0")).toBeNull();
    expect(readMediaFileName("loam-media://images/%E0")).toBeNull();
  });
});
