# kp2 — Markdown runbooks + a browser terminal

English | [日本語](README.ja.md)

kp2 shows a Markdown runbook in the left pane and an xterm.js terminal in the right pane of your browser.
Every `bash` / `sh` / `shell` code block in the runbook gets a **Run** button that sends the command to your local shell.
Think of it as a minimal, local-only Instruqt / Killercoda (MVP).

```
Browser
  Markdown ──Run──▶ xterm.js ──WebSocket (/ws, proxied by Vite)──▶ ttyd ──▶ PTY ──▶ $SHELL
```

## Requirements

- Node.js 20 or later
- [ttyd](https://github.com/tsl0922/ttyd) 1.7 or later (macOS: `brew install ttyd`)
- Optional: [code-server](https://github.com/coder/code-server) (macOS: `brew install code-server`). When installed, a browser-based VS Code pane becomes available

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts the following three processes together.

| Process | Bind address | Role |
| --- | --- | --- |
| ttyd (`scripts/ttyd.sh`) | `127.0.0.1:7681` | PTY and shell (picks `$SHELL`, then `/bin/zsh`, then `/bin/bash`) |
| code-server (`scripts/code-server.sh`) | `127.0.0.1:7682` | Browser-based VS Code. Skipped when not installed, in which case the editor pane is not shown |
| Vite dev server | `127.0.0.1:5173` | Serves the React UI. Proxies `/ws` and `/token` to ttyd and `/code` to code-server |

Open <http://127.0.0.1:5173/> in your browser.

To try a production build, run `npm run build && npm start` (Vite preview + ttyd, same port layout). Live reload of runbooks does not work in preview mode.

## Runbooks

By default, kp2 loads `docs/*.md` from the repository, starting with `docs/getting-started.md`.
The server reads the Markdown at request time, so editing a file updates only the left pane immediately while the terminal keeps running.

### Opening runbooks from another directory

You can point kp2 at any directory outside the repository in three ways.

1. **Type a path**: click the folder name in the header, enter a path such as `~/notes/k8s` in the panel, and press **Open**.
   `.md` files in subdirectories are listed recursively. Recently opened folders appear in the same panel, and the last location is restored on the next start.
2. **Choose folder…** (Chrome / Edge only): pick a folder with the OS folder dialog from the same panel. In this mode the browser reads the files directly and
   the server is not involved. Changes are detected by polling every 2 seconds. After a reload, press **Re-open** to regain access (a browser permission rule).
3. **At startup**: `DOCS_DIR=~/notes npm run dev` changes the default directory. Appending `?dir=<path>` to the URL does the same.

### Favorites (Pinned)

Frequently used folders and runbooks can be pinned. The ☆ next to the runbook name in the header pins the current runbook, and the ☆ inside the folder panel pins a folder or a recent entry. Pinned items open with one click from the **Pinned** section of the panel.

Favorites are stored in a file rather than in the browser, so they survive browser changes and can be edited by hand or kept in your dotfiles.

| Priority | Location |
| --- | --- |
| 1 | `$KP2_CONFIG_DIR/favorites.json` |
| 2 | `$XDG_CONFIG_HOME/kp2/favorites.json` |
| 3 | `~/.config/kp2/favorites.json` |

```json
{
  "favorites": [
    { "dir": "~/notes/k8s" },
    { "dir": "~/notes/k8s", "doc": "setup.md", "label": "K8s setup" }
  ]
}
```

`dir` may start with `~`. `label` is optional and used as the display name. Editing the file by hand is reflected immediately in open browsers.
Folders picked with **Choose folder…** cannot be pinned because the browser does not expose their path. Open them by typing the path instead.

`?doc=<file name>` selects the runbook to show (clicking the file name in the header does the same).

### Nested folders

`.md` files in subdirectories are loaded recursively, and a relative path such as `k8s/setup.md` becomes the runbook name.
The header dropdown groups them by subdirectory.

Relative links inside Markdown (`[Next](./ops/backup.md)`, `[Back](../intro.md)`) switch to that runbook when the target is inside the same folder.
Links that leave the folder or point to a missing file are shown with a strikethrough and do nothing when clicked. `http(s)://` links open in a new tab.

The server only serves `.md` files under the chosen directory; `..` and similar tricks cannot escape it.

Every code block has a **Copy** button that copies its content to the clipboard.
Blocks whose language is `bash` / `sh` / `shell` additionally get these two buttons.

- **Run**: sends the content exactly as shown to the terminal, followed by Enter. Multi-line blocks run line by line in order. **Double-clicking** the code does the same.
- **Insert**: types the content without sending Enter (sent via bracketed paste, so a multi-line block can be edited as a single input).

## Editor (code-server)

When code-server is running, an **Editor** button appears at the right end of the header. Pressing it splits the right pane vertically, with browser-based VS Code on top and the terminal below (drag the divider to resize). Press it again to hide the editor. It is hidden by default, and your choice is remembered by the browser. Clicking a `vscode:` link in a runbook shows the editor automatically. The pencil icon next to the runbook name in the header opens the runbook itself in VS Code; saving updates the left pane immediately.
The folder VS Code opens (the workspace) defaults to the repository root and can be changed with `KP2_WORKSPACE=~/src/myproject npm run dev`.
The terminal and the editor see the same local filesystem, so "read the runbook → edit in the editor → Run → check the result in the terminal" all happens inside the browser.

To open a file from a runbook, write a `vscode:` link. The path is relative to the workspace, and `#L<line>` jumps to a line.

```markdown
[Open main.rs](vscode:src/main.rs#L120)
```

Clicking it makes Vite's `/api/open` run `code-server -r`, which opens the file in the running VS Code instance (no page reload).
When code-server is not running, an explanation is shown instead.

code-server's user data lives in `~/.local/share/kp2/code-server` (or `$XDG_DATA_HOME/kp2/code-server`).
The IPC socket that `code-server -r` uses to find the running instance is created there, so the path has to be short.

## Layout

Drag the divider between the runbook on the left and the terminal on the right to resize them. The width is remembered by the browser. When the editor is shown, the divider between the editor and the terminal can be dragged the same way.

## Terminal

- Ordinary key input and control keys such as Ctrl-C go straight to the shell
- Copy: select and press Cmd+C (macOS) / Ctrl+Shift+C. Paste: Cmd+V / Ctrl+Shift+V
- The PTY is resized to follow window and pane resizes
- If the connection drops, press **Reconnect** at the top of the terminal

## Security

This tool can run arbitrary commands on your local machine.

- ttyd, code-server and Vite all bind to **127.0.0.1 only**. Do not expose them to an external network. code-server runs with `--auth none`, so anyone who can reach it beyond localhost can control it
- What the Run button sends is exactly the content of the code block shown on screen. There are no hidden commands or transformations
- Merely opening a Markdown file executes nothing. Execution always requires a button click or a keystroke
- There is no authentication (MVP). Use it only in a trusted local environment

## Project layout

```
docs/getting-started.md   Runbook (Markdown, the default directory)
scripts/ttyd.sh           Starts ttyd (localhost bind, shell selection)
scripts/code-server.sh    Starts code-server (optional; does nothing when not installed)
vite.config.ts            Localhost bind for the dev/preview server and the proxy to ttyd
vite-docs-plugin.ts       Middleware that serves .md files from any directory and pushes changes over HMR
vite-favorites-plugin.ts  Read/write API for favorites.json and change notifications
vite-editor-plugin.ts     code-server health check (/api/editor) and the open-file API (/api/open)
src/ttyd.ts               Minimal client for the ttyd WebSocket protocol
src/TerminalPane.tsx      xterm.js + fit addon + resize/copy/paste
src/Guide.tsx             Markdown rendering and the Run / Insert buttons
src/docs.ts               Runbook store (server-backed and File System Access API), runbook selection, favorites
src/DocsPicker.tsx        Folder / runbook selector in the header and the folder panel
src/editor.ts             Editor availability, show/hide state, vscode: link handling
src/EditorToggle.tsx      The Editor button in the header
src/SplitPane.tsx         Vertical editor / terminal split (drag to change the ratio)
src/App.tsx               Two-pane layout
```

## Why ttyd

ttyd's WebSocket protocol is very simple (the first byte is the command type: `'0'` = input, `'1'` = resize),
so xterm.js can talk to it directly without ttyd's bundled web UI.
That means kp2 does not have to manage PTYs, resizing or signals itself; the whole backend is a single ttyd process.
