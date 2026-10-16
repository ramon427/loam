# AI access (MCP)

AI clients can use Loam through its built-in Model Context Protocol server.
It operates on the running app's library through the same validated operations as
the desktop UI, including history, backups, encryption and sync.

1. Open **Settings › AI access** and click **Enable AI access**.
2. Click **Copy HTTP configuration** and paste it into your client's MCP server
   configuration. The endpoint is `http://127.0.0.1:47821/mcp` by default; Settings
   lets you choose another port if it is already in use.
3. For clients that launch an MCP process, use **Copy stdio configuration**.
   The app includes a stdio connector that forwards requests to the running app.
4. Keep Loam open. Turn AI access off to disconnect clients, or replace the
   connection key to revoke an old HTTP configuration.

Access starts off and remembers your choice. The local server requires a bearer
connection key and accepts connections only on this computer. The configuration
copied from Settings includes that key, so share it only with clients you authorize.
Access settings and keys live outside note backups and sync. An encrypted library
stays locked for AI clients until it is unlocked.

The tool catalog covers:

- Notes: list, read, create, edit, rename, delete, restore, search and backlinks.
- Folders and placement: create, rename, remove, reorder and move notes.
- Content: all text blocks and formatting, headings, links, checklists, images,
  columns, text/diagram/table tabs, graph shapes and connections, frames, heading
  connections, live graph snapshots, typed table columns and rows, study videos
  and timestamp links.
- Transfer: Markdown/Obsidian, Evernote, Notion and HTML imports, complete vault
  exports, and Mermaid/JSON Canvas diagram imports and exports plus SVG/PNG.
- History, backup creation and restore, sync setup and control, encryption and
  recovery, app information and update management.
- Workspace: open notes/tabs, inspect the current workspace, save pending edits,
  change the app theme and open, play, pause or seek a study video. Diagram templates
  and the app's automatic layouts are also available.

Start with `loam_notes_library` and `loam_notes_get`. Reads save pending editor changes
first. Updates require the `updatedAt` from the last read as `baseUpdatedAt`; stale
AI updates fail with `CONFLICT` so the client can reread before retrying. User edits
made concurrently with an AI update keep the AI content in the note's version history.
Convenience tools such as `loam_notes_new`, `loam_tabs_add`, `loam_blocks_set`,
`loam_graphs_set`, `loam_tables_set` and `loam_import_run` preserve unrelated content.
`loam_notes_save` also accepts the full editor data model. Import/export paths are
absolute local paths, so AI clients can complete transfers without file dialogs.

The server publishes `loam://guide`, `loam://library` and `loam://notes/{noteId}` resources
with usage instructions and current data. Access consent and connection keys are
managed in Settings; those controls and internal window replies are excluded from
MCP. The catalog is checked against the desktop bridge at compile time and in
tests so new app operations cannot be added without an explicit MCP decision.
