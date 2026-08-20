# Session Shelf

Session Shelf is a local-only cross-platform Wails desktop app for reviewing Codex JSONL session storage before reclaiming disk space. It groups forked transcripts by conversation root, shows exact file paths and sizes, previews the first messages on demand, and keeps current and archived sessions in separate views.

It does not upload transcript contents or modify files during a scan. Selected JSONL files are sent to the operating system trash only after a typed `MOVE` confirmation.

## Requirements

- Go 1.25 or newer
- Wails v3 CLI
- Node.js 22.5 or newer and npm
- A local Codex session directory, or explicit path overrides
- Windows WebView2, macOS Xcode Command Line Tools, or the Linux GTK/WebKitGTK dependencies required by Wails

The Codex app and CLI have different platform distributions, so Session Shelf uses the filesystem layout rather than assuming a particular desktop executable. See the [Codex app announcement](https://openai.com/index/introducing-the-codex-app/) and [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) for the current official platform details.

## Run in the browser

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4310/`. `npm start` is an equivalent direct run command. The development server serves the React source directly and updates client changes through Vite HMR; restart it after changing `server.mjs`.

## Run as a Wails desktop app

```sh
npm ci
npm run build
wails3 generate bindings
wails3 dev
```

The production desktop build is:

```sh
npm run build
wails3 build
```

## Storage locations

By default the server resolves the current user’s Codex home directory and scans:

| Purpose | Default |
| --- | --- |
| Codex home | `~/.codex` |
| Current sessions | `~/.codex/sessions` |
| Archived sessions | `~/.codex/archived_sessions` |
| Catalog DB | `~/.codex/sqlite/codex-dev.db` |

The archive directory is optional. A missing archive directory is shown as empty rather than treated as a scan failure.

The **Storage locations** page can change these paths and save them to the operating system’s per-user application configuration directory. Saving applies the paths to scanning, previews, reveal/trash validation, and Catalog DB reads, then rescans. Path-specific environment variables take precedence when supplied at process startup.

Override locations per process when the Codex installation uses a different layout:

| Variable | Purpose |
| --- | --- |
| `CODEX_HOME` | Base Codex directory used for default locations |
| `SESSION_SHELF_ROOT` | Current-session directory |
| `SESSION_SHELF_ARCHIVED_ROOT` | Archived-session directory |
| `CODEX_CATALOG_DB` | SQLite catalog database |
| `CODEX_SQLITE_COMMAND` | SQLite CLI fallback command |
| `PORT` | HTTP port, default `4310` |
| `SESSION_SHELF_DEV` | Set to `0` to serve `dist` instead of Vite |

## In-app controls

- **Preferences** controls whether archived sessions are included in scans and how many preview messages are loaded when a session is selected.
- **Filters** applies minimum size, minimum file count, agent, and fork-only filters to both session tables.
- **Saved filter views** persist named filter presets locally for repeat reviews.
- **Storage locations** edits the absolute current-session, archived-session, and Catalog DB paths and saves them persistently.
- In the Wails desktop app, **Browse** uses native folder/file dialogs; overlapping current/archive roots are rejected before saving.
- **Search transcript** streams a selected root for message matches, while the Overview can export metadata as JSON or CSV.
- Active conversations can be archived directly from the inspector after a fresh preflight; paths are preserved below the configured archive root and Catalog DB rows remain intact.
- **Diagnostics** reports platform support, configured storage availability, trash support, scan status, and local index state.
- Selections persist across roots in the Review queue, so bulk review does not silently narrow to the currently highlighted conversation.
- **Rename** creates a local title alias when the Codex catalog title is missing or noisy; aliases are stored separately from transcripts.
- The Wails backend keeps a metadata-only scan index and exposes cache hits, scan progress, and cancellation for large storage trees.
- The Wails desktop shell uses a frameless, draggable custom title bar with native window controls; browser mode keeps the same visual chrome without pretending to control the browser window.
- Global chrome does not display full filesystem paths; those remain available on the Storage locations page.

## Safety model

- Scanning reads JSONL metadata only; transcript previews read only the selected root on demand.
- Current and archived sessions are scanned separately and can be reviewed with the same grouping and preview workflow.
- The move dialog requires typing `MOVE`.
- The archive dialog requires typing `ARCHIVE`; it never removes Catalog DB rows and blocks root overlap, collisions, changed files, and unscanned files.
- Every move runs a fresh size/mtime/path/access preflight against the latest scan and blocks changed or unscanned files.
- The optional **Remove matching Catalog DB entries** checkbox is off by default. When enabled, Session Shelf removes only UUIDs belonging to files that successfully reached system trash, in one transactional database operation.
- Catalog cleanup creates a timestamped SQLite backup before any row mutation; the backup is preserved even if a later cleanup step fails.
- Catalog rows are never removed automatically during a scan. The Catalog DB page requires an explicit `REMOVE` confirmation for orphaned metadata rows.
- The app never deletes an entire directory and does not treat a build or scan as permission to modify the Codex database.

## Development

```sh
npm run check
npm run build
```

Do not commit local transcripts, the Codex database, `node_modules`, or generated `dist` output. The repository is intentionally source-first so people can clone it and run it directly.

## License

MIT
