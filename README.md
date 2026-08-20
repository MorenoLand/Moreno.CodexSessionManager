# Session Shelf

Session Shelf is a local-only cross-platform browser for reviewing Codex JSONL session storage before reclaiming disk space. It groups forked transcripts by conversation root, shows exact file paths and sizes, previews the first messages on demand, and keeps current and archived sessions in separate views.

It does not upload transcript contents or modify files during a scan. Selected JSONL files are sent to the operating system trash only after a typed `MOVE` confirmation.

## Requirements

- Node.js 22.5 or newer
- A local Codex session directory, or explicit path overrides
- SQLite access for the Catalog DB page: Node’s built-in `node:sqlite` is used first; install the `sqlite3` command and set `CODEX_SQLITE_COMMAND` only when using a different SQLite executable

The Codex app and CLI have different platform distributions, so Session Shelf uses the filesystem layout rather than assuming a particular desktop executable. See the [Codex app announcement](https://openai.com/index/introducing-the-codex-app/) and [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) for the current official platform details.

## Run without a build

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4310/`. `npm start` is an equivalent direct run command. The development server serves the React source directly and updates client changes through Vite HMR; restart it after changing `server.mjs`.

The production-style static path is optional:

```sh
npm run build
SESSION_SHELF_DEV=0 npm start
```

On PowerShell, use `$env:SESSION_SHELF_DEV = '0'` before `npm start`.

## Storage locations

By default the server resolves the current user’s Codex home directory and scans:

| Purpose | Default |
| --- | --- |
| Codex home | `~/.codex` |
| Current sessions | `~/.codex/sessions` |
| Archived sessions | `~/.codex/archived_sessions` |
| Catalog DB | `~/.codex/sqlite/codex-dev.db` |

The archive directory is optional. A missing archive directory is shown as empty rather than treated as a scan failure.

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

## Safety model

- Scanning reads JSONL metadata only; transcript previews read only the selected root on demand.
- Current and archived sessions are scanned separately and can be reviewed with the same grouping and preview workflow.
- The move dialog requires typing `MOVE`.
- The optional **Remove matching Catalog DB entries** checkbox is off by default. When enabled, Session Shelf removes only UUIDs belonging to files that successfully reached system trash, in one transactional database operation.
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
