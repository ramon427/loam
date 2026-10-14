import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NOTICE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

/** The package folder a bundled module comes from, or null for the app's own code. */
const packageDirectoryOf = (modulePath: string) => {
  const path = modulePath.replace(/\\/g, "/").replace(/^\0/, "").split("?")[0];
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const [scope = "", name = ""] = rest;
  const packageName = scope.startsWith("@") ? `${scope}/${name}` : scope;
  return `${path.slice(0, at)}/node_modules/${packageName}`;
};

/** Licenses the app can't ship under MIT; a package must offer another one. */
const NOT_SHIPPABLE = /GPL|PROPRIETARY|UNLICENSED|SEE LICENSE/i;

const isShippable = (license: string) =>
  license
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/i)
    .some((choice) => !NOT_SHIPPABLE.test(choice));

/**
 * The license text of every package the given modules come from. The app
 * bundles its dependencies instead of shipping node_modules, so their notices
 * (which MIT, BSD, Apache and MPL ask to be kept) ship in this file instead.
 */
export const thirdPartyLicenses = (modulePaths: Iterable<string>) => {
  const directories = new Set<string>();
  for (const modulePath of modulePaths) {
    const directory = packageDirectoryOf(modulePath);
    if (directory && existsSync(join(directory, "package.json"))) directories.add(directory);
  }
  const sections = [...directories]
    .map((directory) => {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        name: string;
        version: string;
        license?: string;
      };
      const notices = readdirSync(directory)
        .filter((file) => NOTICE_FILE.test(file))
        .sort()
        .map((file) => readFileSync(join(directory, file), "utf8").trim());
      const license = manifest.license ?? "see the package";
      if (manifest.license && !isShippable(manifest.license)) {
        throw new Error(`${manifest.name} is licensed ${license}, which the app can't ship.`);
      }
      const body = notices.length ? notices.join("\n\n") : `License: ${license}`;
      return { id: `${manifest.name}@${manifest.version}`, license, body };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const rule = "-".repeat(78);
  return [
    "Loam includes the following third-party software.",
    "",
    ...sections.map(({ id, license, body }) => `${rule}\n${id} (${license})\n${rule}\n\n${body}\n`),
  ].join("\n");
};
