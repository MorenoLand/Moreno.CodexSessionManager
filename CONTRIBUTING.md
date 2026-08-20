# Contributing

Session Shelf is a local-first Wails desktop application. Keep transcript contents and Catalog DB data out of commits, fixtures, logs, screenshots, and issue reports.

## Development prerequisites

- Go 1.25 or newer
- Node.js 22.5 or newer and npm
- Wails v3 CLI (`wails3`)
- Windows: WebView2; macOS: Xcode Command Line Tools; Linux: Ubuntu 24.04+/GTK4/WebKitGTK 6 or the Wails-supported equivalent for the target distribution

## Local workflow

```sh
npm ci
npm run build
wails3 generate bindings
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

The GitHub Actions matrix runs JavaScript checks, Go tests, and a native Wails build on Windows, macOS, and Ubuntu 24.04. Keep fixtures synthetic and do not add generated `frontend/dist` or `build/bin` output.

## Cross-platform changes

Use Go standard-library path and filesystem APIs. Platform-specific reveal, trash, window, and packaging behavior belongs behind a small service boundary with a fallback or explicit diagnostic when the platform capability is unavailable.
