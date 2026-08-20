# Security Policy

Session Shelf reads local Codex transcript files and may move selected files to the operating system trash. Treat all session content and Catalog DB files as sensitive local data.

## Reporting a vulnerability

Please report security issues privately through GitHub’s private vulnerability reporting or a private maintainer contact. Do not publish transcript samples, Catalog DB copies, access tokens, home-directory paths, or other private data in a public issue.

Include the affected commit or release, operating system, reproduction steps using synthetic data where possible, and the impact. We will acknowledge reports when practical and coordinate a fix before public disclosure.

## Security boundaries

- The application is designed to operate locally and does not require a network service for its desktop build.
- Scans should be metadata-only; transcript previews are explicitly selected and bounded.
- Destructive operations must remain confirmation-gated, path-validated, and recoverable through the operating system trash where available.
- Never commit real Codex sessions, Catalog DB files, credentials, or generated diagnostic dumps.
