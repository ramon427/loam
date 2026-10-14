# Side chat

An optional AI assistant in a panel beside your notes: ask it anything, and it
can search the web, use a browser, and read, write and organize your notes. It
is off by default; turn it on in **Settings › Side chat**, then open it with
**Ctrl+Shift+J** (**Cmd+Shift+J** on macOS).

- **Bring your own model:** an Anthropic or OpenAI API key, any
  OpenAI-compatible service (OpenRouter, Ollama, LM Studio), or the Claude Code
  or Codex CLI you already have installed and signed in to. CLI support is
  experimental; whether your subscription may be used this way is up to its
  terms.
- **The web:** web search and page reading (with Anthropic and the CLIs, their
  own; with OpenAI-style APIs, Loam's page reader), and Loam's browser window, which
  you can watch as the assistant opens pages, clicks and types. Its sign-ins
  stay apart from the app.
- **Your computer:** with a CLI provider, the assistant can also read your
  files and run commands, as the access mode allows.
- **Access modes:** _Supervised_ asks before any change, _Auto-accept edits_
  edits notes freely and asks before creating, moving, deleting or acting
  outside Loam (clicks, typing, commands), and _Full access_ never asks. _Plan_
  mode only reads and proposes. Every action shows in the chat; note changes
  can be undone.

Keys are encrypted by your operating system and stay on this computer. Chats
are kept beside your notes, encrypted when your notes are, and are not synced
or backed up.
