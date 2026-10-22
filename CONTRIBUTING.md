# Contributing to Loam

Thanks for helping. Bug reports, fixes, tests and small focused features are
all welcome. For anything large, open an issue first so we can agree on the
shape before you spend time on it.

## Set up

You need Node.js 24 (see `.nvmrc`).

```sh
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and Electron with hot reload. The app
keeps its data in Electron's user-data folder; set `LOAM_DATA_DIR` to use another
folder, for example a scratch one while testing:

```sh
LOAM_DATA_DIR=/tmp/loam-scratch npm run dev
```

| Command               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `npm run dev`         | The app with hot reload.                                        |
| `npm run build`       | Builds the window and the Electron main process and preload.    |
| `npm start`           | Builds, then runs the production build.                         |
| `npm run check`       | Typecheck, lint, unused-code check (Knip), format check, tests. |
| `npm test`            | Vitest unit tests.                                              |
| `npm run e2e`         | Builds, then drives the real app with Playwright.               |
| `npm run format`      | Formats everything with Prettier.                               |
| `npm run bench`       | Times the store, export, backup and import at 10,000 notes.     |
| `npm run package:win` | Builds a Windows installer into `apps/desktop/release/`.        |
| `npm run package:mac` | Builds the macOS disk images (on a Mac) into the same folder.   |

## Find your way around

[docs/architecture.md](docs/architecture.md) explains how the app is built.
In short:

- `apps/desktop/src/main` is the Electron main process: the store, media,
  backups, sync, encryption, import and export, AI access, and the requests
  the window makes.
- `apps/desktop/src/renderer` is the window, a React app: its layout,
  settings, side chat and plugins.
- `packages/notes-ui` is the notes screens, grouped by what each part of the
  screen does (the sidebar, the open note, the editor, graphs, tables); other
  apps can host them.
- `packages/storage` is `NotesStore`, the storage adapters, history, sync and
  encryption.
- `packages/transfer` converts notes to and from Markdown and other formats.
- `packages/shared` is the note model and what both processes need.
- `packages/plugin-api` holds the plugin API's types; `examples/plugins` has
  plugins written against it, and `apps/desktop/plugins` the ones that ship
  with the app.

## Before you open a pull request

```sh
npm run check   # typecheck, lint, Knip, format check, unit tests
npm run e2e     # builds the app and drives it with Playwright
```

On Linux without a display, run the end-to-end tests under a virtual one:
`xvfb-run -a npm run e2e`. A few tests click through the window system, as a
user does, which needs an X display and `xdotool`.

Add or update tests with your change:

- **Unit tests** sit next to the code in `__tests__` folders and run with
  Vitest. Test what a user sees and what gets saved: render the component,
  act through roles and labels, and check the screen or the store. Don't test
  markup, class names or a component's internals.
- **End-to-end tests** in `e2e/` start the real app on an empty data folder
  through the `loam` fixture (`e2e/app.ts`), act like a user, and check what the
  store saved. Use them for anything a user does across screens, or across a
  restart.
- **Benchmarks** (`npm run bench`) time the store at 10,000 notes. Run them
  when you change how notes are stored, searched or listed, and update the
  table in [docs/performance.md](docs/performance.md) if the numbers move.

## Changing stored data

Notes outlive the app version that wrote them, and other computers running an
older version read what this one syncs. If you change what the store writes,
upgrade older data when the store opens (see
`packages/storage/src/migrations.ts`) and add a test that opens data in
the old shape. Backups restore through the same path, so they upgrade too.
Keep the formats notes store (link hrefs, block JSON, sync file names) as
they are.

A new storage backend must pass the adapter contract tests in
`packages/storage/src/__tests__/storageAdapters.test.ts`.

## Code style

Prettier formats, ESLint allows no warnings, and Knip fails the check on
unused files, exports or dependencies. Beyond what the tools check:

- **One owner per concept.** Each piece of state, each format and each rule
  lives in one module; others call it. Prefer a small interface over layers
  that pass calls along, and delete code rather than keep it "in case".
- **Imports.** Inside a package (or the app), import files by relative path;
  import another package as `@loam/<package>/<file>`. There are no barrel
  `index.ts` files. ESLint also keeps the window from importing main-process
  code and the packages from importing the app.
- **Requests.** A bridge request handler decodes its parameters, calls one
  service and maps its errors (it may first show a dialog for a path the
  service needs). The work belongs in the service.
- **Components own their styling.** A component's look lives in its classes or
  its CSS module, not in global CSS that overrides it from elsewhere.
- **Names** say what things are in the app: notes, folders, tabs, versions.
  `Note*` is about one note, `Notes*` about the library. Components and
  classes live in PascalCase files named after their main export; other
  files are camelCase, and hooks start with `use`.
- **Licenses.** Everything the app bundles must allow shipping under MIT; the
  build fails on a GPL-only package.
- **Comments** say why, or a contract the code can't show. Write them in the
  present tense, without history ("used to", "now"). Keep user-facing text
  short and plain.

## Commits

Write the subject in the imperative ("Keep backlinks fresh after a save") and
use the body to say why the change is needed and anything a reviewer should
know. One logical change per commit.

## AI access during development

`npm run build` also builds the MCP stdio connector. A stdio client can then
run it against a running development app:

```sh
npm run --silent mcp -- --config "/absolute/path/to/data/mcp-connection.json"
```

The connector forwards requests to the running app; it never opens the
database itself.

## Releasing

Every merged pull request makes a release: the Auto release workflow bumps the
patch version in `apps/desktop/package.json`, commits `Release x.y.z` to `main`
and tags it, then the Release workflow builds the Windows installer and the
macOS disk images (Apple silicon and Intel) and publishes them as one GitHub
Release, once both builds are up. For a minor or major version, set `version`
in the pull request; a version not released yet is released as it is. Auto
release can also be run by hand from the Actions tab.

The Mac build workflow builds the disk images without releasing them, for pull
requests that change the packaging, or by hand from the Actions tab for any
branch; they are kept as a workflow artifact for a week.

There is no Apple Developer certificate, so the Mac app is signed ad hoc (Apple
silicon runs only signed code) and not notarized; the README says how to open
it the first time.

Installed copies check for updates 15 seconds after launch and then hourly
(`apps/desktop/src/main/updates.ts`). On Windows they download in the
background and offer "Restart to update" in the sidebar; an update also
installs the next time the app quits. macOS installs only signed updates, so
the Mac app shows the new version in the sidebar and links to its release
page. Drafts are never offered.

## Security

Report security problems privately, as [SECURITY.md](SECURITY.md) describes,
not in a public issue.

By contributing you agree that your work is released under the
[MIT License](LICENSE).
