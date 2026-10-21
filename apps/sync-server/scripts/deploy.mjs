#!/usr/bin/env node
// Sets up a Loam sync server in your Cloudflare account and prints its sync code:
// creates the R2 bucket, deploys the Worker and gives it a new key. Run again to
// update the Worker; the key, and so the sync code, stays unless you pass --new-code.
//
//   node apps/sync-server/scripts/deploy.mjs [--new-code]
//
// Wrangler asks you to sign in to Cloudflare the first time.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const WRANGLER = "wrangler@4.151.3";
const BUCKET = "loam-sync";
const directory = fileURLToPath(new URL("..", import.meta.url));

const wrangler = (args, { input, check = true } = {}) => {
  const result = spawnSync("npx", ["--yes", WRANGLER, ...args], {
    cwd: directory,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const output = `${result.stdout}${result.stderr}`;
  if (check && result.status !== 0) {
    console.error(output);
    process.exit(result.status ?? 1);
  }
  return { ok: result.status === 0, output };
};

const buckets = wrangler(["r2", "bucket", "list"]).output;
if (!new RegExp(`^name:\\s+${BUCKET}$`, "m").test(buckets)) {
  console.log(`Creating the R2 bucket ${BUCKET}…`);
  wrangler(["r2", "bucket", "create", BUCKET]);
}

console.log("Deploying the sync server…");
const deployed = wrangler(["deploy"]).output;
const url = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
if (!url) {
  console.error(deployed);
  console.error("Deployed, but the Worker's address isn't in Wrangler's output.");
  process.exit(1);
}

const secrets = wrangler(["secret", "list", "--format", "json"], { check: false }).output;
if (secrets.includes('"SYNC_KEY"') && !process.argv.includes("--new-code")) {
  console.log(`\nThe sync server at ${url} is up to date. Its sync code hasn't changed.`);
  process.exit(0);
}

const key = randomBytes(32).toString("base64url");
wrangler(["secret", "put", "SYNC_KEY"], { input: key });
console.log(
  `\nYour sync code (paste it in Loam › Settings › Sync on each computer, and keep it private):\n\n  ${url}/#${key}\n`,
);
