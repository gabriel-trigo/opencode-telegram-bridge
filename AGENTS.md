# OpenCode Telegram Bridge

## Project goal
Run a Telegram bot that forwards messages to an OpenCode backend and returns responses. The MVP focuses on reliable message intake, allowlisted access, and clean service operation with text-only request/response.

## Architecture
- Run OpenCode in server mode (`opencode serve`) on the same host, bound to localhost.
- A long-running Telegram bot process translates Telegram messages into OpenCode SDK calls.
- Each Telegram chat reuses an OpenCode session stored in-memory by chat id.
- Project aliases persist in SQLite at `~/.opencode-telegram-bridge/projects.db`, with `home` mapped to the OS home directory.

## Useful commands
- Install dependencies: `npm install`
- Start dev bot (watch mode): `npm run dev`
- Build: `npm run build`
- Run built bot: `npm start`
- Typecheck: `npm run typecheck`

## Tests and validation
- No test suite yet. When added, document the test command here.
- Validate changes by running `npm run typecheck` and `npm run build`.

## Unit test guidance
- Add tests only when they verify meaningful behavior (config parsing, auth allowlist, event handling, error paths).
- Avoid tests that only duplicate TypeScript or library behavior.
- Prefer small, deterministic tests over end-to-end coverage.
