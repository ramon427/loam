# Security

## Reporting a problem

Please report security problems privately, through **Report a vulnerability**
on this repository's Security tab, not in a public issue. Say what an attacker
could do and how to reproduce it. Fixes ship in the next release. Installed
copies on Windows update themselves; the Mac app, which is unsigned, says when
a new version is out and links to it.

## How Loam protects your notes

Loam keeps notes on your computer and has no server. The things it guards
against are web content and files it doesn't control: pages a link opens,
pasted or imported content, and files that appear in a sync folder.

### The window

- The window runs with context isolation, the Chromium sandbox and no Node.js.
  The preload gives it one object, `window.loam`, which reaches only the methods
  listed in `packages/shared/src/bridge/loamBridge.ts`; the main process checks
  every request's parameters before running it.
- The app is served from its own `loam-app://` protocol with a strict Content
  Security Policy, and it loads no remote code.
- Links open in your browser only for `http`, `https` and `mailto`. The window
  never navigates away from the app or opens other windows.
- Images are served from `loam-media://` by random file name only. A note may
  also show an image from an `https` address; loading it tells that site your
  IP address and when the note was opened.
- The window may write to the clipboard and play video full screen. Only the
  app's own page may read the clipboard, for the editor's Paste, and use the
  microphone, for dictating to the side chat; embedded videos can't, and no
  page gets the camera. Nothing else is granted.

### Sync

Sync reads only Loam's own folder inside the sync folder you pick, and treats
every file in it as untrusted: a change is checked like any other save, and
only image files with Loam's random names are copied in. Without encryption,
anyone who can read that folder can read your notes.

An import reads only what you pick in the system's file dialog, or what you
drop on Settings › Import & export and then confirm in a system dialog the
window can't answer for you.

A file tab can link to a file where it is on your computer. A note can name
any path, so Loam reads, writes, opens or copies in a linked file only when
this computer linked that path itself. It keeps those paths, hashed, in
`linked-files.json` in the data folder, outside notes, backups and sync.

### Encryption

Settings › Security › "Encrypt my notes" encrypts the library with a random
256-bit key. Every stored record, image, backup and sync file is sealed with
AES-256-GCM and bound to where it is stored (a record's collection and id, an
image's or sync file's name), so a changed or swapped file is refused rather
than read. The key itself is never stored: `encryption.json` in the data
folder (and `library.json` in a sync folder) holds it locked twice, by your
passphrase (scrypt, N=2^17, r=8, p=1) and by a recovery key (HKDF-SHA256)
shown once when you turn encryption on.

- Turning encryption on or off rewrites the library in place, after a backup.
  Every step skips what is already done, so a crash part way finishes at the
  next launch. Plain backups are encrypted too; backups made while encryption
  was on stay encrypted after it is turned off and restore with that passphrase.
- Search can't use the database's text index on encrypted notes, so it scans
  an in-memory copy built after unlocking.
- The first computer to encrypt a shared library encrypts the sync folder. The
  others pause syncing until their passphrase (or the recovery key) is entered
  in Settings › Sync, which encrypts their notes with the same key. Until then,
  the files they wrote to the sync folder before stay readable. Turning
  encryption off turns sync off on that computer.
- Until the passphrase is entered, the window shows only the unlock screen,
  and the main process answers only whether the notes are locked, the
  passphrase or recovery key that unlocks them, and the colors of the
  window's buttons.
  Every other request fails as locked, and images aren't served.

What encryption doesn't hide: note, folder and image ids, how many there are,
their sizes and when they change (all visible in file names and the
database), Markdown exports, which are plain files, and edits not yet saved
when the app closes, which the window keeps in its own storage until the next
launch saves them.

### AI access

The MCP server is off until you turn it on in Settings › AI access. It listens
only on this computer and requires a bearer connection key, which Settings can
replace to revoke an old configuration. It changes notes through the same
checked operations as the app. While an encrypted library is locked, an AI
client can only read that it is locked: every other tool fails, and no tool
unlocks the notes or resets the passphrase, so they stay locked until you
unlock them in the app. Access settings and keys are kept outside backups and
sync.

The side chat is off until you turn it on. API keys are sealed by the
operating system's keychain; where it has none (Linux without a keyring),
Loam doesn't save keys. A key is forgotten when the service's address changes.
Each chat's access mode decides what the assistant does without asking. A
supervised chat asks before any change, before reaching the web (reading or
searching a page can carry what the assistant read in your notes to that
site), and before Claude Code reads files outside the chat's own folder or
uses a tool Loam doesn't know. Codex can't stop to ask, so a supervised Codex
searches only a cached web index. Loam's own page reader refuses addresses on
this computer or its local network, including where a redirect leads.
