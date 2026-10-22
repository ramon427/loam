# Working on Loam

Guidance for AI coding agents (and a quick start for people). The full rules
are in [CONTRIBUTING.md](CONTRIBUTING.md) and the design in
[docs/architecture.md](docs/architecture.md); read both before a large change.

## Commands

```sh
npm ci                 # install (Node 24, see .nvmrc); applies patches/
npm run check          # typecheck, lint, Knip, Prettier check, unit tests
npm test -- <path>     # one Vitest file or folder
npm run e2e            # build, then drive the real app with Playwright
xvfb-run -a npm run e2e   # the same on Linux without a display
```

A change is done when `npm run check` passes, and `npm run e2e` too if it can
affect the running app. Run `npm run format` rather than hand-formatting.

## Layout

- `apps/desktop/src/main`: Electron main process (store, sync, encryption,
  backups, import and export, AI, MCP server, bridge request handlers).
- `apps/desktop/src/preload`: exposes `window.loam` and nothing else.
- `apps/desktop/src/renderer`: the React window (layout, settings, side chat,
  plugins). It reaches the main process only through `window.loam`.
- `packages/notes-ui`: the notes screens, one folder per part of the screen.
  They reach their data only through the `NotesHost` they are given, so other
  apps can host them (see "Hosting the notes screens" in the architecture).
- `packages/shared`: the note model and the bridge contract
  (`src/bridge/loamBridge.ts`).
- `packages/storage`: `NotesStore`, storage adapters, history, sync, encryption.
- `packages/transfer`: pure conversions to and from Markdown and other formats.
- `packages/plugin-api` and `examples/plugins`: the plugin API types and examples.
- `e2e/`: Playwright tests through the `loam` fixture in `e2e/app.ts`.

## Rules that are easy to break

- **Stored data is a contract.** Notes outlive the version that wrote them and
  sync to older versions. Upgrade old data on open
  (`packages/storage/src/migrations.ts`) and test the old shape.
- **Security boundaries.** The window is sandboxed; every bridge request is
  validated in `apps/desktop/src/main/requests/params.ts`. Treat sync folder
  files, imports, pasted HTML, web pages and AI output as untrusted. Keep
  [SECURITY.md](SECURITY.md) true when you change any of this.
- **Imports.** Relative paths inside a package; `@loam/<package>/<file>`
  across packages; no barrel `index.ts`. ESLint enforces the process boundaries.
- **Request handlers** decode parameters, call one service and map its errors;
  the work lives in the service.
- **One owner per concept**, components own their styling, delete dead code
  (Knip fails on unused files, exports and dependencies).
- **Names** use the app's words: notes, folders, tabs, versions. `Note*` is
  about one note, `Notes*` about the library. Components and classes are
  PascalCase files; everything else is camelCase; hooks start with `use`.
- **Comments** say why, in the present tense, with no history ("used to",
  "now"). User-facing text is short and plain.
- **Tests** check what the user sees and what the store saves, not markup or
  internals. Unit tests sit in `__tests__` next to the code.
- **Dependencies** are pinned exactly and must be MIT-compatible: no GPL or
  AGPL code may ship in the app.

## Commits

Imperative subject ("Keep backlinks fresh after a save"), body says why. One
logical change per commit.
