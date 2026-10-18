import { writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Writes the calendar plugin's table of Windows time zone names ("W. Europe Standard Time")
 * and the IANA zone each stands for, from the Unicode CLDR's windowsZones.xml. Outlook and
 * Exchange name zones the Windows way in the calendars they publish.
 *
 *   node scripts/generateWindowsZones.ts [cldr-release-tag]
 */

const TAG = process.argv[2] ?? "release-48-2";
const SOURCE = `https://raw.githubusercontent.com/unicode-org/cldr/${TAG}/common/supplemental/windowsZones.xml`;
const LICENSE = "https://www.unicode.org/license.txt";
const OUTPUT = join(
  import.meta.dirname,
  "..",
  "apps",
  "desktop",
  "plugins",
  "google-calendar",
  "src",
  "windowsZones.ts",
);

const [xml, license] = await Promise.all(
  [SOURCE, LICENSE].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.text();
  }),
);

// The "001" territory is each Windows zone's main IANA zone, which CLDR calls the golden zone.
const zones = new Map<string, string>();
for (const match of xml!.matchAll(/<mapZone other="([^"]+)" territory="001" type="([^"]+)"\s*\/>/g))
  zones.set(match[1]!, match[2]!.split(" ")[0]!);
if (zones.size < 100)
  throw new Error(`Only ${zones.size} zones were read; has the format changed?`);

const notice = license!
  .trim()
  .split("\n")
  .map((line) => ` * ${line}`.trimEnd())
  .join("\n");
const entries = [...zones]
  .sort(([a], [b]) => a.localeCompare(b))
  // Quoted only where needed, as Prettier writes keys.
  .map(([windows, iana]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(windows) ? windows : JSON.stringify(windows);
    return `  ${key}: ${JSON.stringify(iana)},`;
  })
  .join("\n");

writeFileSync(
  OUTPUT,
  `/*!
 * Windows time zone names and the IANA zone each stands for, from the Unicode CLDR
 * (${TAG}, common/supplemental/windowsZones.xml, territory 001). Made by
 * scripts/generateWindowsZones.ts; run it again rather than editing this file.
 *
${notice}
 */

export const WINDOWS_ZONES: Record<string, string> = {
${entries}
};
`,
);
console.log(`Wrote ${zones.size} zones to ${OUTPUT}`);
