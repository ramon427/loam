# How Loam works

This is the map for changing Loam: where each part lives, how data moves
between them, and the rules the code keeps. The [README](../README.md)
describes what the app does; [CONTRIBUTING](../CONTRIBUTING.md) covers setup
and checks.

## Two processes and a bridge

Loam is an Electron app, so it runs as two processes.

- **The main process** (`apps/desktop/src/main`) owns the data. It opens the
  store, the media folder and the backups, runs sync, encryption, imports and
  exports, serves the AI access (MCP) server, and checks for updates.
- **The window** (`apps/desktop/src/renderer`) is a React app. It renders the
  library and the open note and asks the main process for everything else.

The window runs sandboxed, with context isolation and no Node.js. The preload
script (`apps/desktop/src/preload/preload.ts`) gives it one object,
`window.loam`:

- `window.loam.invoke(method, params)` calls a main-process method and resolves
  to `{ ok: true, data }` or `{ ok: false, error }`.
- `window.loam.on(event, listener)` listens to events the main process sends,
  such as `notes.changed` after sync brings in changes.

Every method and event is declared once, with its parameters and result, in
`packages/shared/src/bridge/loamBridge.ts`. The main process handles them in
`apps/desktop/src/main/requests/`: `params.ts` checks each method's parameters
with zod, `handlers.ts` maps each method to one call into the store or another
service, and `dispatch.ts` turns failures into the bridge's error codes. A
handler only decodes, calls and maps (it may first pick a path with a dialog);
the work belongs to the service it calls.

The window is served from the `loam-app://` protocol with a strict Content
Security Policy, and images from `loam-media://` by random file name. Links open
in the browser only for `http`, `https` and `mailto`.

## Packages

| Path                        | What it holds                                                                                                                                    | Runs in         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `apps/desktop/src/main`     | Electron main process: window, protocols, store setup, media, backups, sync, encryption, import/export, MCP, side chat, plugins, themes, updates | main            |
| `apps/desktop/src/preload`  | The `window.loam` bridge                                                                                                                         | preload         |
| `apps/desktop/src/renderer` | The window's React app                                                                                                                           | window          |
| `packages/shared`           | The note model, the bridge contract, in-app link formats, heading connections, graph and video helpers                                           | both            |
| `packages/storage`          | `NotesStore`, the stored-note schema, storage adapters (SQLite, memory), version history, search, sync and encryption                            | main            |
| `packages/transfer`         | Import parsing (Markdown, Obsidian, Evernote, Notion, HTML), Markdown export, JSON Canvas and Mermaid                                            | main and window |
| `packages/plugin-api`       | The types plugins are written against; `examples/plugins` uses them                                                                              | plugins         |

Imports follow two rules, and ESLint checks both:

- Inside a package (or the app), files import each other by relative path.
  Another package is imported by path, as `@loam/<package>/<file>`; there
  are no barrel `index.ts` files.
- `shared`, `storage` and `transfer` never import the app, Electron or React.
  The window never imports the main process, the preload or `storage`; it
  reaches them through `window.loam`. The main process never imports window code.

## The window's code

`apps/desktop/src/renderer` is grouped by what each part does, not by kind of
file:

| Folder                       | What it holds                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `App.tsx`                    | The window: sidebar, the open note, settings, and their shortcuts                        |
| `bridge.ts`                  | `callBridge` and `onBridgeEvent` over `window.loam`, and `BridgeError`                   |
| `automation.ts`              | Requests from AI clients that need the window, such as opening a note                    |
| `workspace/`                 | The library and open-note cache, and saving                                              |
| `sidebar/`                   | The notes tree: selection, drag and drop, its commands and right-click menu              |
| `note/`                      | The open note: header, tabs and their kinds, layout, and the view that composes its tabs |
| `editor/`                    | Page tabs: the BlockNote editor, links, mentions, headings and their connections         |
| `editor/columns/`            | Column layouts: dropping a block beside another, resizing, the slash menu items          |
| `board/`, `embed/`, `files/` | Board tabs, embed tabs, and PDF, Word and Markdown file tabs                             |
| `graph/`, `table/`, `video/` | Graph tabs, table tabs, and the study video beside a note                                |
| `ai/`                        | The side chat panel: messages, composer, model picker, note mentions                     |
| `commands/`                  | The command palette                                                                      |
| `plugins/`                   | Plugin workers, the host that answers their calls, and the elements they draw            |
| `themes/`                    | Theme presets and the user's CSS customizations                                          |
| `history/`                   | Version history and the preview of a saved version                                       |
| `search/`                    | Search across notes and find in the open note                                            |
| `import-export/`             | Imports and Markdown export                                                              |
| `settings/`, `security/`     | The settings screen, and unlocking an encrypted library                                  |
| `media/`                     | Images: uploads, `loam-media://` URLs, previews                                          |
| `shell/`                     | The window's top row and native buttons, the sidebar's size and toggle, updates          |
| `keyboard/`, `action-menu/`  | Shortcuts and the pieces of right-click menus                                            |
| `ui/`, `styles/`             | Shared controls (buttons, dialogs, menus, inputs) and the design tokens                  |
| `lib/`                       | Small helpers several folders use                                                        |
| `testing/`                   | Helpers for tests, such as a fake `window.loam`                                          |

The window has no router: which note is open is state in the workspace, and a
link to a note opens it through the workspace.

## A note

A note is stored as two records. Its **row** holds what the library list,
search and backlinks read: title, place, position, the notes it links to and
its plain text. Its place is a folder, a project, the top level, or another
note (`parentNoteId`), which makes it a sub-note shown under that note.
`resolveNoteParents` in `shared/notes/noteParents.ts` ignores parents that are
gone or would put a note inside itself, so every note still shows somewhere.
A sub-note made from the sidebar is linked from its parent's page with an
ordinary note link, which stays when the sub-note moves out. Its **content**
holds the rest:

- **Tabs.** A page tab holds BlockNote blocks (`blocksByTab`). A graph tab
  holds a diagram (`graphsByTab`): nodes, edges and frames. A table tab holds
  typed columns and rows (`tablesByTab`), and so does a board tab, which
  shows the rows as cards grouped by the select column `groupColumnId` names.
  An embed tab holds the address of a web page or image (`embedsByTab`). A
  PDF, Word or Markdown tab shows a file (`filesByTab`): one copied into the
  media folder, or one at a path on this computer.
  `TAB_CONTENT_KEYS` in `shared/notes/noteModel.ts` names each kind's map.
  Tabs saved with the kind `text` before page tabs had their name are pages.
  Older versions saved Text tabs, holding one Markdown string
  (`textsByTab`), with the kind `markdown`; a `markdown` tab without a file
  is one of those, and opens as a graph holding its Markdown. Backlinks tabs
  from older versions are dropped.
- **A video** to study beside the note, with the moment last watched.

`packages/storage/src/noteSchema.ts` is the shape a stored note must
have. The store checks every write against it (a save, a new or restored note,
an import, a change from another computer), so anything in the database can
be read and shown. It checks the structure the app walks and keeps every other
field as it came, so a note written by a newer version is never trimmed.

Two things inside a note have their own module in `shared`:

- **In-app links** (`notes/noteLinks.ts`): a link to another note is stored as
  `/notes?noteId=<id>` and a link to a moment in the video as
  `#note-video?t=<seconds>`. Notes keep these hrefs, so the formats never
  change.
- **Heading connections** (`notes/headingConnections.ts`): a graph node, table
  row or table column can connect to headings in the note's page tabs. Each
  target stores the ids of its headings; a connection holds while its id names
  one heading in a page tab, and the store drops the others when it reads a
  note.

## Saving

The window holds the library and each open note in one TanStack Query cache,
through `NotesWorkspaceProvider` (`renderer/workspace/NotesWorkspace.tsx`).
That cache is the only copy of a note in the window: editors read the note
from it and change it with `updateNote(noteId, patch)`.

`updateNote` records which fields changed. `renderer/workspace/noteSaves.ts`
saves them 800 ms after the last change, when the note is left, or when the
user presses Done, with one save per note at a time; edits made meanwhile
follow it. Edits not saved yet are also written to the window's localStorage
shortly after each change and as the window closes, and the next launch saves
them before it reads any note. A save names the version of the note it
started from. If sync or an AI client changed the note since, the user's edit
is saved and the version it replaced is kept in the note's history as a
conflict, and a toast offers to compare them; an
AI client's own stale write is refused instead, so it reads the note again.

Each page tab has its own BlockNote editor (`renderer/editor/PageTabEditor.tsx`),
so switching tabs never swaps one editor's document. The other tabs are React
components over the same note. `renderer/note/tabKinds.tsx` names each kind
and groups the add-tab menu; changing a tab's kind carries its content over
through `renderer/note/tabConversions.ts`.

## File tabs

PDF, Word and Markdown tabs show a file (`filesByTab`), which is in one of
three places:

- **Imported**: a PDF or Word document copied into the media folder beside
  the images, named `<uuid>.pdf` or `<uuid>.docx`, so sync, backups and
  encryption carry it as they carry images. Media files are never replaced,
  so a document edited in another app comes back under a new name.
- **Text**: a Markdown file's text, held in the note itself. It is searched,
  its note links count as backlinks, and versions keep it.
- **Referenced**: a path on the computer that linked it (`computerId`, the
  library's sync device id). It isn't copied, synced or encrypted; other
  computers show it as on another computer, and **Copy into notes** turns it
  into an imported file or text.

`main/tabFiles.ts` owns these files. It reads a file only when its name and
its bytes are the kind of file the tab shows (a PDF header, a zip holding
`word/document.xml`, UTF-8 text), so the window can't use it to read other
files on this computer. A note can name any path, so it uses a linked file
only when this computer linked that path itself: it keeps those paths, as
SHA-256 hashes, in `linked-files.json` in the data folder, outside notes,
backups and sync. It writes linked Markdown back where it is, watches
linked files while a tab shows them (the window reads them again on
`files.changed`), and opens files in the system's app: a linked file where it
is, a library file as a temporary copy that comes back into the tab when that
app saves it.

The viewers load with the first tab that needs them: pdf.js's own viewer
for PDFs (selectable text, links, find, zoom, and the page each PDF was left
at), docx-preview for Word documents (read only), and CodeMirror for
Markdown, which edits the text as it is so the file never changes form.

A file tab is added with its file: picked and copied in, or new Markdown
text. A file opened from outside the notes (Ctrl+O, a drop on the window, or
the system's "Open with", which waits in the main process until the window
takes it) shows over the open note; **Keep as reference** makes a note with
that file, linked, as its tab. Any file tab can show beside the note in the
video's column, which this computer remembers per note.

## History and backups

`packages/storage/src/noteHistory.ts` keeps the content a note had before it
changes, at most once every ten minutes, and before a delete or restore. It
keeps every version from the last day, hourly ones for a week and daily ones
for 30 days. A version that lost a sync conflict is marked and always kept.
Restoring a version saves the current content as a version first. History
belongs to the computer: it doesn't sync.

`apps/desktop/src/main/backups/` copies the whole library once a day and
before every import or restore. A backup holds every collection except
`sync`, which belongs to the computer.

## Sync

Sync (`apps/desktop/src/main/sync.ts` over `packages/storage/src/sync/`) goes
through a folder that a cloud drive (Dropbox, iCloud Drive, OneDrive,
Syncthing) keeps in step between computers. Loam never runs a server.

- A note's content, its place in the library and each folder sync as separate
  documents, so moving a note never conflicts with editing it.
- Every change is queued for sync in the same database commit that saves it,
  so nothing is saved without being queued.
- Each computer writes one file per changed document into its own subfolder,
  so no two computers write the same file.
- Version vectors tell whether two versions were edited at the same time. Then
  the newest edit wins and the other is kept, marked, in the note's history on
  each computer that sees both, which shows a toast to compare them. A computer
  that keeps its own edit over another publishes the clocks it won over
  (`overrode`), so the computer whose edit lost keeps that edit too, though it
  never saw both. Computers on versions before this publish "(conflict copy)"
  notes instead, which arrive as ordinary notes. An edit always beats a delete.

Every file in the sync folder is untrusted: changes are checked like any other
save, and only image files with Loam's random names are copied in.

## Encryption

`apps/desktop/src/main/encryption/` holds the library's key while it is
unlocked. The store opens its adapter through `withEncryption`
(`packages/storage/src/encryption/encryptedAdapter.ts`): with a key, that
seals each record on the way in and opens it on the way out with AES-256-GCM,
bound to where the record is stored, so the store above it works unchanged
and a swapped file is refused. Images, backups and sync files are sealed the same
way. The library key is never stored; it is locked by the passphrase (scrypt)
and by a recovery key.

Until the passphrase is entered, the window shows only the unlock screen.
`apps/desktop/src/main/libraryGate.ts` holds the library once it is open and
lists the requests answered before then: the window may read the encryption
status, unlock (with the passphrase or the recovery key) and set the title
bar's colors; AI clients may only read the status. The request dispatch checks
that list for every request, and the MCP tools check it before they do
anything, so everything else fails with `LOCKED`.

## Storage backends

The store talks to a small `StorageAdapter` interface
(`packages/storage/src/adapter.ts`). An adapter keeps JSON records in a few
named collections and applies a batch of writes all at once. Everything else
(note rows, links, placement, history, the search fallback) lives in
`NotesStore`, so every backend saves notes the same way. New releases can add
a collection (see `STORAGE_COLLECTIONS`), so an adapter must store any
collection name it is given.

To add a backend, for example a database server:

1. Implement `StorageAdapter`: `get`, `list` and `commit` (apply a batch of
   writes, all or none), and optionally `searchNotes`, `readSnapshot`,
   `compact` and `close`. The SQLite and memory adapters in
   `packages/storage/src/adapters/` are working references.
2. Add it to the contract tests in
   `packages/storage/src/__tests__/storageAdapters.test.ts` and make them pass.
3. Register it in `STORAGE_ADAPTERS` in `apps/desktop/src/main/storage.ts`.
4. Select it in `<data folder>/storage.json`; `options` reaches your factory
   as it is:

   ```json
   { "adapter": "my-db", "options": { "connectionString": "..." } }
   ```

Without `storage.json`, the app uses SQLite. A `storage.json` that isn't
valid, or names an adapter that isn't registered, stops the app at launch
with an error saying what is wrong; it never falls back to another store.

## AI access

The MCP server (`apps/desktop/src/main/mcp/`) runs in the main process and
calls the same services as the bridge, so an AI client's change is checked and
saved like the user's. `bridgeTools.ts` maps bridge methods to tools, and a
test checks that every bridge method has an explicit decision, so a new
method can't reach AI clients by accident. Requests that need the window, such
as opening a note or playing the video, wait until the window has loaded.

## Side chat

The side chat (`apps/desktop/src/main/ai/`) is an assistant in a panel beside
the notes, off until the user turns it on. Turns run in the main process, so
API keys, encrypted with Electron's `safeStorage`, never reach the window; the
window sends a message and shows what comes back as `ai.event`.

- `chatTools.ts` picks the AI tools the chat may use and classes each as
  reading, reaching the web, editing a note, organizing the library, or
  acting outside Loam.
  Before a note change runs it records how to undo it, so it can be undone,
  even after a restart. Tools not listed there (backups, sync, security) stay
  out.
- `browser.ts` is a browser window of the assistant's own, with its own
  session, that it opens pages in, reads, clicks and types into; `webRead.ts`
  reads a page as text for providers without a web tool, and refuses
  addresses on this computer or its local network, redirects included.
- `service.ts` holds the chat's settings, providers and threads; `turn.ts`
  runs each turn and checks every tool call against the chat's
  access mode: supervised asks before any change or web request, auto-accept
  edits asks before organizing or acting outside Loam, full access never asks.
- `providers/` reach the model: the Anthropic API (with its web search and
  fetch), OpenAI or a service with its API (with the user's key), or the
  user's own `claude` or `codex` CLI, run from the home folder with its own
  tools under the access mode: Claude Code's permission prompts come to the
  chat as approvals (reading files counts as acting outside Loam except in the
  turn's own folder, and a tool Loam doesn't know counts the same), and
  Codex's sandbox follows the mode; a supervised Codex searches only the
  cached web index. A CLI reaches
  Loam's notes and browser through `chatMcp.ts`, a private MCP endpoint with a
  key for each turn; connectors set up in the CLI stay out.
- `threads.ts` saves chats in `ai-chats/`, sealed with the library's key
  while encryption is on, outside notes, backups and sync.
- `attachments.ts` keeps the files sent with messages in `ai-chat-files/`, a
  folder per chat, sealed the same way. It checks each file's bytes: images
  and PDFs go to the API providers as they are (OpenAI-compatible services
  get a PDF's text), other files as text; the window reads a PDF's or Word
  document's text before sending, with pdf.js and the document's XML. CLI
  providers find the files in the turn's folder; Codex gets images with `-i`.

## Columns

Column layouts in page tabs are Loam's own blocks, `columnList` holding
`column`s with a relative `width` (`packages/shared/src/notes/columnBlocks.ts`),
so the editor, imports and exports share one schema. The editor's dragging and
resizing live in `renderer/editor/columns/`.

## Dependency licenses

The app ships under MIT and bundles its dependencies, so every package it
includes must offer a license compatible with that. Both builds write the
notices of what they bundle to `THIRD_PARTY_LICENSES.txt`
(`apps/desktop/scripts/thirdPartyLicenses.ts`) and fail on a package that
offers only GPL or a proprietary license.

## Patched dependencies

`patches/` holds fixes to dependencies, applied by `patch-package` after every
install. Each patch changes the published `dist/` files the app runs and the
`src/` files beside them, which show the change readably.

- `@blocknote/core`: toggle buttons get `aria-label` and `aria-expanded`, and
  Enter or Space on them stays out of the editor's shortcuts. A file block
  counts its pending uploads, so its "add file" button comes back when the last
  one ends.
- `@blocknote/react`: the emoji menu points `aria-activedescendant` at the
  right item (it skipped the first). The file panel's Embed tab takes a URL
  check and shows its error, and the Upload tab shows a failed upload.
  `FileReplaceButton` accepts the app's own file panel.
- `@blocknote/shadcn`: the panel's text and file inputs pass on the extra
  props the patched panel gives them.
- `prosemirror-view`: a destroyed editor doesn't redraw its document after
  its plugins are cleaned up. The `overrides` in `package.json` keep a single
  copy of `prosemirror-view`, `prosemirror-model` and `prosemirror-transform`,
  so BlockNote and the app share one ProseMirror.

To change a patch, edit the package in `node_modules`, run
`npx patch-package <package>`, and commit the new file. After upgrading a
patched package, check whether the fix is upstream and delete the patch if so.

## Tests

- **Unit tests** sit next to the code in `__tests__` folders and run with
  Vitest. Window code is tested through what the user sees (Testing Library on
  jsdom, with the real BlockNote editor), not through markup or internals.
- **End-to-end tests** (`e2e/`) start the built app on an empty data folder
  through the `loam` fixture (`e2e/app.ts`), act like a user, and check what the
  store saved.
- **Benchmarks** (`npm run bench`) time the store, export, backup and import
  at 10,000 notes.
