import { describe, expect, it } from "vitest";

import { readEmbedAddress, viewEmbed } from "../noteEmbed";

const IMAGE = "11111111-1111-4111-8111-111111111111.png";

describe("embed addresses", () => {
  it("keeps https pages and stored images, adding https to a bare address", () => {
    expect(readEmbedAddress(" example.com/docs ")).toBe("https://example.com/docs");
    expect(readEmbedAddress("https://example.com")).toBe("https://example.com/");
    expect(readEmbedAddress(IMAGE)).toBe(IMAGE);
    for (const refused of ["", "http://example.com", "javascript:alert(1)", "file:///etc/hosts"])
      expect(readEmbedAddress(refused)).toBeNull();
  });

  it("shows pages in a frame, images as images, and YouTube in its player", () => {
    expect(viewEmbed("https://example.com/")).toEqual({
      type: "page",
      src: "https://example.com/",
      address: "https://example.com/",
    });
    expect(viewEmbed("https://example.com/cat.webp")).toMatchObject({ type: "image" });
    expect(viewEmbed(IMAGE)).toEqual({
      type: "image",
      src: `loam-media://images/${IMAGE}`,
      address: null,
    });
    expect(viewEmbed("https://youtu.be/dQw4w9WgXcQ?t=30")?.src).toMatch(
      /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?.*start=30/,
    );
    expect(viewEmbed("http://example.com")).toBeNull();
  });
});
