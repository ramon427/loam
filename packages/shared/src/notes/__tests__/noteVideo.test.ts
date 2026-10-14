import { describe, expect, it } from "vitest";

import {
  buildYouTubePlayerCommandMessage,
  buildYouTubeEmbedUrl,
  formatVideoTimestamp,
  parseVideoTimestamp,
  parseYouTubePlayerCurrentSeconds,
  parseYouTubePlayerPlaying,
  parseYouTubeUrl,
} from "../noteVideo";

describe("note video helpers", () => {
  const watch = (videoId: string, startSeconds?: number) => ({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    startSeconds,
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m23s", watch("dQw4w9WgXcQ", 83)],
    ["https://youtu.be/dQw4w9WgXcQ?start=90", watch("dQw4w9WgXcQ", 90)],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", watch("dQw4w9WgXcQ")],
    ["https://www.youtube.com/watch?v=e8j5nuTwWWQ&pp=ugUEEgJlbg%3D%3D", watch("e8j5nuTwWWQ")],
    // Not YouTube, or not a valid id.
    ["https://example.com/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/watch?v=bad", null],
  ])("parses the YouTube URL %s", (url, expected) => {
    expect(parseYouTubeUrl(url)).toEqual(expected);
  });

  it("builds playable embed URLs with an optional origin", () => {
    expect(buildYouTubeEmbedUrl("e8j5nuTwWWQ")).toBe(
      "https://www.youtube.com/embed/e8j5nuTwWWQ?autoplay=0&rel=0&modestbranding=1&enablejsapi=1&playsinline=1",
    );
    expect(buildYouTubeEmbedUrl("e8j5nuTwWWQ", 83)).toBe(
      "https://www.youtube.com/embed/e8j5nuTwWWQ?autoplay=0&rel=0&modestbranding=1&enablejsapi=1&start=83&playsinline=1",
    );
    expect(buildYouTubeEmbedUrl("e8j5nuTwWWQ", 0, "http://127.0.0.1:3000/notes")).toBe(
      "https://www.youtube.com/embed/e8j5nuTwWWQ?autoplay=0&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&origin=http%3A%2F%2F127.0.0.1%3A3000",
    );
  });

  it("builds and reads YouTube player messages", () => {
    expect(buildYouTubePlayerCommandMessage("seekTo", [83, true])).toBe(
      JSON.stringify({ event: "command", func: "seekTo", args: [83, true] }),
    );
    expect(
      parseYouTubePlayerCurrentSeconds(
        JSON.stringify({
          event: "infoDelivery",
          info: { currentTime: 83.8 },
        }),
      ),
    ).toBe(83);
    expect(parseYouTubePlayerCurrentSeconds("not json")).toBeNull();
  });

  it("reads whether the player is playing", () => {
    expect(parseYouTubePlayerPlaying(JSON.stringify({ event: "onStateChange", info: 1 }))).toBe(
      true,
    );
    expect(
      parseYouTubePlayerPlaying(
        JSON.stringify({ event: "infoDelivery", info: { playerState: 2 } }),
      ),
    ).toBe(false);
    expect(
      parseYouTubePlayerPlaying(
        JSON.stringify({ event: "infoDelivery", info: { currentTime: 4 } }),
      ),
    ).toBeNull();
  });

  it("formats and parses timestamps", () => {
    expect(parseVideoTimestamp("1:02:03")).toBe(3723);
    expect(formatVideoTimestamp(83)).toBe("1:23");
  });
});
