import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseCsv } from "../csv";
import { createImportProgress } from "../importTypes";
import { md5Hex } from "../md5";

const encode = (text: string) => new TextEncoder().encode(text);

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks", () => {
    expect(parseCsv('\uFEFFName,Notes\r\n"Plan, v2","Said ""hi""\nthen left"\r\nEmpty,\n')).toEqual(
      [
        ["Name", "Notes"],
        ["Plan, v2", 'Said "hi"\nthen left'],
        ["Empty", ""],
      ],
    );
  });

  it("handles a missing final newline and empty input", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("md5Hex", () => {
  it("matches the RFC 1321 test vectors", () => {
    expect(md5Hex(encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex(encode("message digest"))).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(
      md5Hex(
        encode("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
      ),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("matches Node's MD5 around every block boundary", () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const bytes = randomBytes(length);
      expect(md5Hex(new Uint8Array(bytes))).toBe(createHash("md5").update(bytes).digest("hex"));
    }
  });
});

describe("createImportProgress", () => {
  it("reports every 25 notes and at the end, yielding each time", async () => {
    const reports: Array<[number, number]> = [];
    const step = createImportProgress(60, (done, total) => reports.push([done, total]));
    for (let index = 0; index < 60; index += 1) await step();
    expect(reports).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ]);
  });
});
