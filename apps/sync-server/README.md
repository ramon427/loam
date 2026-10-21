# Loam sync server

Sync your notes between computers without a cloud drive app: a small
Cloudflare Worker keeps Loam's sync files in an R2 bucket in your own
Cloudflare account. It stays within Cloudflare's free tier for one person's
notes.

## Set it up

You need Node 24 and a free Cloudflare account.

```sh
node apps/sync-server/scripts/deploy.mjs
```

Wrangler asks you to sign in to Cloudflare the first time. The script creates
the `loam-sync` bucket, deploys the Worker and prints a **sync code**. On each
computer, open **Settings › Sync**, paste the code under **Sync server** and
click **Connect**.

Run the script again to update the Worker; the sync code stays the same. Pass
`--new-code` to replace it (for example if it leaked); every computer then
needs the new code.

## Keep it private

Anyone with the sync code can read and change the files on the server. Turn on
encryption in **Settings › Security** so the server only ever holds sealed
files; the other computers then ask for the passphrase once.
