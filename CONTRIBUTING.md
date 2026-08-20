# Contributing

Session Shelf is a local-first Wails desktop application. Keep transcript contents and Catalog DB data out of commits, fixtures, logs, screenshots, and issue reports.

## Development prerequisites

- Go 1.25 or newer
- Node.js 22.5 or newer and npm
- Wails v3 CLI (`wails3`)
- Windows: WebView2; macOS: Xcode Command Line Tools; Linux: the GTK/WebKitGTK development packages required by Wails

## Local workflow

```sh
npm ci
npm run build
wails3 generate bindings -b
wails3 dev
```

The browser-compatible development server remains available with `npm run dev` at `http://127.0.0.1:4310/`. Use it for frontend-only work; use Wails for Go service and desktop integration work.

Before committing, run:

```sh
npm run check
npm run build
go test ./...
git diff --check
```

Keep commits focused and reversible. A migration or feature slice should include its tests and documentation, and should not depend on a user’s private Codex storage layout.

## Cross-platform changes

Use Go standard-library path and filesystem APIs. Platform-specific reveal, trash, window, and packaging behavior belongs behind a small service boundary with a fallback or explicit diagnostic when the platform capability is unavailable.
