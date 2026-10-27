# NCHAT


A local-first, node-based prompt graph for [LM Studio](https://lmstudio.ai/). Create prompt nodes, stream responses into new sibling nodes, connect answers into follow-up prompts, and explore the resulting graph instead of managing a conventional chat transcript.

This project has been entirely vibe coded, i'm not an engineer of any kind, i was bored

## Features

- **Home page** listing every workspace, with search, sorting, rename, duplicate, delete after a plain confirmation, and JSON import
- **Browser-style tabs**: several workspaces open at once, each with its own store and its own React Flow canvas
- Infinite React Flow canvas with pan, zoom, minimap, fit view, search palette, and auto-layout
- Node types: **prompt**, **response**, **system**, **note**, **output**, **summary**, **image**, **file**, **folder**, **brain**
- Every run creates an immutable response branch; existing answers are never overwritten
- **Undo and redo for the document**: moving, creating, deleting, connecting, resizing and grouping, with `Ctrl+Z`. A drag is one step, not two hundred
- **Execution queue** with configurable concurrency, dependency tracking, pause/resume, ETA, and reorder
- **Model manager**: downloads models on the first keystroke, unloads the previous one, detects the LM Studio API level
- **Grouping answers**: select two or more response nodes, right-click, and the **dashed frame around them becomes the group**. There is no extra node: the frame is what you drag into a prompt to send all the grouped answers as context, and it follows the answers when you move them. Drag the frame's bar to move the whole group. Click its label to read the merged text
- **Images can join a group**, and reach the model as real image parts rather than a text marker
- **Global generation parameters**: temperature, top-p and max output tokens live in Settings, not on each node
- **Per-prompt thinking switch**: a reasoning model can answer directly instead of thinking first
- **Per-prompt short-answer switch**: asks for a brief reply and lowers the output ceiling, to spend fewer tokens on that one prompt
- **Runs as its own window**: a desktop shortcut starts the dev server, opens a dedicated window, and leaves a system tray icon. Closing the window does not stop the server; the tray menu does. All against the dev server, so hot reload keeps working
- **`/compact`**: replaces a long history with a non-destructive **Summary** node, with Undo
- **File node**: give it a text file (`.txt`, `.md`, `.json`, `.csv`, `.html`, source code) and its text is sent with the prompt. PDF and Office formats are refused with a reason rather than read badly. Truncation is stated, never silent
- **Folder node**: one button picks a real directory on disk. Its text files are read and sent as context, and the same folder is what a Brain reads. Files it could not read are listed by name with the reason
- **Brain node**: an instruction, a folder to read and a folder to write. It works through the files one at a time, one model call each, and writes the answers. It is **not** an agent: the model never picks a tool, never sees the folder, and never decides what happens next, so a bad answer can only cost one file. **Only the two folders you granted can ever be touched** — that is the browser's guarantee — and every file name is checked before anything is written. What happens when a file already exists is a setting on the node, and **Rename** is the default because it is the only option that cannot lose work. A run can be put back file by file, which the document's own Undo cannot do
- **Drag a handle and release on empty canvas to get the next node**: the palette opens showing **only the node types that would connect from that handle**, and picking one creates it where you let go and wires it in the same action. Pick it with the mouse, the arrows, or Tab and Enter. Nothing the graph would refuse is ever offered, so no node is ever created and then left dangling
- **Optional question on an image node**, hidden until you ask for it, sent in the same message as the picture
- Copy, cut, paste, and duplicate nodes, also between tabs and browser windows
- Resizable nodes with per-type limits, persisted across reloads. The grab area on every border, corner and connection handle is several times larger than what you see
- **Collapse any node** to its header with the chevron, Blender style, so a busy graph fits on screen
- **Drop an image, a video, a text file or a whole folder on the canvas** and the matching node appears under the mouse. Connect an image to a prompt's image input and the picture is sent with the question to a vision model
- New nodes appear under the mouse, whether inserted, pasted or duplicated
- The Inspector is hidden by default and lives behind **Settings → Developer**
- Deterministic graph-derived `messages[]`, cycle prevention, and request preview
- Streaming SSE with stop, retry-in-place, continue, and copy actions
- Safe Markdown/GFM output with code highlighting and no raw model HTML
- Dark/light themes, and a separate **Look** setting in Settings → Appearance that
  picks the material: the solid one, or a Liquid Glass look with translucent
  surfaces, ambient light behind them, and soft blurred edges
- **Zoomed far out, a node blurs and one line of it comes forward**: an answer
  shows its own text, a prompt its first words, a picture is left sharp
- **Local models through LM Studio, or NVIDIA NIM and Google AI Studio in the cloud.**
  A `Local | API` switch in the top bar; the colour changes so you can see which kind
  you are in without reading, and the model list changes with it — never showing one
  provider's models while the other is selected
- **The API key never leaves a local process.** A small local service holds it in
  memory and passes it to the provider; it is never written to disk, never stored in
  the app, and never sent back out. The cost is that you enter it again after the
  service restarts
- **One key per provider.** Switching to Google does not send your NVIDIA key to
  Google, and the field says which provider it is for and which others already have
  one. Clearing it also tells the local service to let it go
- **No waiting in the cloud.** A cloud model is already running on someone else's
  machine, so there is no load, no download, and no wait before the first message —
  and no probe request billed before your prompt. The settings that only mean
  something for a local model (load on typing, one model in memory, load timeout)
  disappear in API mode. Temperature, top-p and maximum output tokens stay, because
  the provider applies them: the last one is what caps what an answer can cost
- **The service address is editable**, so a provider that moves its endpoint does
  not leave you stuck
- **The Brain stays local on purpose.** It would send the contents of your folders
  to the model, so it refuses a cloud provider and says so on the node
- **A log you can read**, in the ⋯ menu. It records what the provider answered and
  what failed inside the app, keeps telling apart "their side" from "our side", and
  survives a restart — so an error that crashed the page is still there. **API keys
  never enter it**, by field name as well as by value, so you can paste it anywhere
  without thinking about it
- **Nodes grow with their text, and stop.** A prompt you are typing gets taller as
  you write, up to a limit; past that the text scrolls inside the node and the node
  stops growing. An answer prefers to grow downwards — a paragraph reads badly on a
  line that is too long
- **One icon, and it starts everything.** The Desktop shortcut starts the server, the
  cloud proxy and the window. "Model server down" is not an error: it means LM Studio
  is not running, and the canvas works without it — it is only needed to run an answer
  locally, and not at all in the cloud
- **The mouse wheel scrolls text.** Put the pointer over an answer, or over a text
  field, and the wheel scrolls it instead of zooming the canvas. At the end of the
  text the wheel carries on and zooms, so you are never left with a cursor that does
  nothing
- Keyboard navigation, visible focus, and live status announcements
- No account, no telemetry, no analytics, no cookies. The only thing that leaves
  the machine is a prompt, and only when you have chosen **API**

Notes on the cloud work, and what is still unverified, are in `idk/NOTE-cloud.md`.

## Requirements

- Node.js **20.19 or newer**
- npm
- LM Studio **0.3 or newer** with its local server started

## Run locally

On Windows, the simplest path is to double-click:

```text
start-dev.cmd
```

It installs the dependencies on first run and starts Vite. To stop the server,
press `Ctrl+C` in that window.

From a terminal in this `NCHAT` directory:

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally:

```text
http://localhost:5173
```

On Windows PowerShell, if script execution is disabled, use `npm.cmd` instead of `npm`:

```powershell
npm.cmd install
npm.cmd run dev
```

## Run it as its own window

All of it works **against the development server**, so hot reload keeps working
while you edit.

### The desktop shortcut: server + window + tray icon

```text
create-desktop-shortcut.cmd
```

Creates **NCHAT.lnk** on the Desktop and in the Start menu. Double-clicking it
does this:

1. checks LM Studio is running,
2. installs dependencies on first run, then starts the Vite dev server,
3. opens the app in a dedicated window, no tabs and no address bar,
4. leaves an **icon in the system tray**, next to the clock.

The server's life is the tray's, not the window's:

- **Close the app window and the server keeps running.** Reopen it from the tray
  with a double click on the icon, or **Apri NCHAT**.
- **Stop the server from the tray**: right-click the icon → **Ferma il server ed
  esci**. That is the only thing that shuts the server down.
- The tray also has **Apri il log del server**, which opens
  `logs/dev-server.log` in Notepad, and a status line that says whether the
  server is up. If the server dies on its own, the tray says so in a balloon and
  **Apri NCHAT** restarts it.

This is the same shape Discord uses: closing the window is not the same as
quitting.

`start-app.cmd` does the same thing if you would rather double-click it in the
project folder than use the shortcut. To remove the shortcut:

```text
create-desktop-shortcut.cmd delete
```

The `.lnk` points at `tools/run-tray.ps1`, so if you move the project folder,
re-run the creator to update the paths.

The tray also starts `tools/cloud-proxy.mjs` on port 1235, the local service that
holds cloud API keys in memory. It is optional: if it does not start, the app opens
normally and only the cloud providers are unavailable. You can also run it by hand:

```powershell
node tools\cloud-proxy.mjs
```

Because it keeps keys in memory and never writes them, **restarting it means
entering the key again** in Settings → Connection.

If the tray process is killed from the task manager, the server survives, because
nothing is left to run the cleanup. Recover with:

```powershell
powershell -ExecutionPolicy Bypass -File tools\run-tray.ps1 -StopServer
```

### Installing from the app instead

**Not recommended, and the app no longer offers it.** The manifest in
`public/manifest.webmanifest` is still there and Chromium will still install from its
own menu, but the resulting shortcut is a second way to open the same thing, and a
worse one:

- it starts nothing, so it opens a blank page unless the server is already up;
- it has no tray icon, so there is no menu to stop the server, and it starts no
  cloud proxy, so an API key never reaches the provider;
- it uses the browser's profile, not the launcher's, so the two windows do not share
  the same state.

That is how two icons ended up on the Desktop, one of which did not work. The app
therefore does not offer to install itself, and `tools\install-shortcut.ps1` removes
any installed-app shortcut it finds, on the Desktop and in the Start menu. It looks
for them by their `--app-url` argument rather than by name, because the name Chromium
gives them follows the manifest title and changes.

No service worker is involved, deliberately: one is not needed for installation and
would risk serving stale modules while you are editing.

### Why not Electron

Electron would give a real `.exe`, at the cost of a second `node_modules`, a
second build pipeline, ~150 MB of runtime, and an IPC layer between the app and
LM Studio to maintain. It would also split the development workflow in two. The
tray icon above is a real system tray icon with a real menu, written in about
250 lines of PowerShell against `System.Windows.Forms`, which ships with every
Windows: no dependency, no build step. The full reasoning is in
`SPEC-DEVIATIONS.md`.

You land on the Home page. **New workspace** creates one and opens it in a tab.

## LM Studio quickstart

1. Open LM Studio and download at least one chat model. Embedding models are not listed.
2. Open the **Developer** tab and start the local server. Default URL: `http://localhost:1234`.
3. In NCHAT, wait for the top-bar pill to show **Connected**.
4. **Add node → Prompt**, type a question, press `Ctrl+Enter`.

Development mode uses the Vite `/lm` proxy by default, so LM Studio CORS does not need to change.

### Model loading (v2)

NCHAT loads the selected model in memory **when you start typing** in a prompt, so
the first Run does not wait. This needs one of:

- **LM Studio 0.4+ with the native REST API** — best: `GET /api/v1/models`,
  `POST /api/v1/models/load`, `POST /api/v1/models/unload`. NCHAT also polls while
  loading, so a model that another client already made resident does not hang the
  queue.
- **LM Studio 0.3.x** — `GET /api/v0/models` lists downloaded models with a `state`
  field, but there is no load endpoint, so NCHAT falls back to a 1-token warm-up.
- **Neither** — enable **Just-in-Time model loading** in LM Studio → Developer, or
  load the model manually.

If the API level is not supported NCHAT tells you in Settings → Connection which
level it detected. Two options in Settings control this:

- **Load model when I start typing** (default on)
- **Keep only one model in memory** (default on, suits a machine with room for one model)

### Reasoning models

If the selected model is a reasoning model, its thinking arrives in a separate
`reasoning_content` channel. NCHAT shows it in a collapsible **Thinking** section
and never mixes it into the answer or sends it back as context. If a model spends
its whole `max_tokens` budget thinking and returns no visible answer, the node is
marked as failed with a hint to raise **Max output tokens**.

Each prompt has a **Thinking** switch next to its Run button. Turn it off and the
run sends `reasoning_effort: "none"`, which LM Studio honours: the model skips the
thinking phase and answers straight away. On a `qwen3.5-9b` reasoning model this
took a one-word answer from 107 tokens down to 2. The switch is per prompt, so you
can reason about the hard questions and answer the easy ones directly.

Generation parameters are **global**. Temperature, top-p and max output tokens are
in Settings → Generation and apply to every prompt in the workspace; the Inspector
shows the current values and links there.

### Direct connection / production build

Turn off **Use Vite dev proxy** in Settings and enable **Allow all origins** in LM Studio's Developer tab. Alternatively, start LM Studio with:

```bash
lms server start --yolo
```

A static build has no Vite proxy. You can host it behind your own same-origin proxy or use direct mode with LM Studio CORS enabled.

## Commands

```bash
npm run dev          # start the Vite development server
npm run typecheck    # strict TypeScript project check
npm test             # run the Vitest suite once
npm run test:watch   # watch tests
npm run test:coverage
npm run build        # type-check and build to dist/
npm run preview      # serve the production build
npm run check        # typecheck + tests + production build
```

## Keyboard shortcuts

Browser-reserved combinations (`Ctrl+T`, `Ctrl+W`, `Ctrl+N`, `Ctrl+Tab`, `Ctrl+1..9`)
are deliberately not used, because a page cannot intercept them reliably.

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo a node move, creation, deletion, connection, resize or group. Inside a text field this stays the browser's own text undo |
| `Tab` / `Ctrl+K` | Open the node palette |
| `Ctrl+Enter` | Run the selected prompt, or N selected prompts in topological order |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste nodes (never inside a text field) |
| `Ctrl+D` | Duplicate the selection |
| `Esc` | Close a dialog, menu, or palette |
| `Delete` / `Backspace` | Delete selected nodes or edges |
| `F` | Fit the graph in view |
| `A` | Auto-layout |
| `1` | Reset zoom to 100% |
| Arrow keys | Nudge selection by 8 px |
| `Shift+Arrow` | Nudge selection by 32 px |
| `Ctrl+S` | Save immediately |
| `Ctrl+E` | Export workspace |
| `Ctrl+,` | Open Settings |
| `Alt+N` | New workspace (Home) |
| `Alt+T` | New workspace in a new tab |
| `Alt+W` | Close the active tab |
| `Alt+H` | Go to Home |
| `Alt+PageDown` / `Alt+PageUp` | Next / previous tab |
| `Alt+1..9` | Go to tab N |
| `F2` | Rename the focused workspace card (Home) |

## Where your data lives

Everything is local to the browser profile. There is no server and no account.

| Location | Contents |
|---|---|
| IndexedDB `nchat` → `workspaces` | lightweight metadata: name, dates, node/edge counts, size, revision |
| IndexedDB `nchat` → `documents` | the full serialized document, one per workspace |
| IndexedDB `nchat` → `appState` | global settings, open tabs, UI preferences |
| IndexedDB `nchat` → `snapshots` | up to 5 snapshots per workspace (import replace, delete, manual) |
| `localStorage` | `nchat.ui.v1` only, plus `nchat.legacy.*` if you upgrade from v1 |

Old v1 data in `localStorage` (`nchat.workspace.v1`) is migrated automatically on
first launch. The original key is **renamed** to `nchat.legacy.*`, never deleted,
and the migration can be retried safely if interrupted.

If IndexedDB is unavailable (some private modes), NCHAT falls back to an
in-memory repository and warns you that changes will not survive a reload.

Use **Export JSON** before clearing browser data or moving to another browser
profile. Imported files are parsed and validated with zod before use.

## Project layout

```text
NCHAT/
├── src/
│   ├── actions/       run, stop, connect, clipboard, queue jobs, workspace lifecycle
│   ├── components/    canvas, nodes, shell, home, tabs, inspector
│   ├── hooks/         autosave, app-settings saving, connection health, clipboard, drafts, shortcuts
│   ├── llm/           LM Studio client, cloud proxy client, native model API, SSE parser, token estimates
│   ├── logic/         pure graph assembly, aggregation, validation, layout, compact, provider catalogue
│   ├── logging/       the error log, with the key redaction that makes it safe to paste
│   ├── nodes/         node type registry and size limits
│   ├── persistence/   Dexie schema, repository, zod import schema, normalization
│   ├── queue/         global execution queue service and its store
│   ├── store/         workspace registry, per-instance workspace store, run/ui/tabs/model stores
│   ├── styles/        theme tokens, base styling, v2 overrides, glass look
│   └── types/         document, settings, and error contracts
├── tools/
│   ├── run-tray.ps1       tray icon, window, server lifecycle, cloud proxy lifecycle
│   └── cloud-proxy.mjs    local service that holds cloud API keys in memory
├── SPEC-DEVIATIONS.md
└── vite.config.ts
```

Design notes and the reasoning behind each v2 decision, including the LM Studio
endpoints verified against a real installation, are in `SPEC-DEVIATIONS.md`.
The v2 feature contract, `SPEC/10-v2-features.md`, is kept in the project folder
that contains this repository, not inside it.
