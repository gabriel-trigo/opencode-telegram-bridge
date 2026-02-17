# OpenCode Telegram Bridge

## Project goal
Run a Telegram bot that forwards Telegram messages to an OpenCode backend and returns responses. The MVP focuses on reliable message intake, allowlisted access, and clean service operation with text + single-image request/response.

## Documentation guidelines
- Keep documentation (README, docs, AGENTS) lean, extremely clear, and always up to date.
- Each docs page is a commitment to keep it current; outdated or incorrect docs are worse than no docs.
- The docs in `docs/` are for end users, not contributors. They should help users run the bridge without confusion and resolve confusion quickly.

## Architecture
- Run OpenCode in server mode (`opencode serve`) on the same host, bound to localhost.
- A long-running Telegram bot process translates Telegram messages into OpenCode SDK calls.
- Each Telegram chat reuses an OpenCode session per project, with session ids persisted in SQLite by chat id and project path.
- Project aliases and chat project selection persist in SQLite at `~/.opencode-telegram-bridge/projects.db`, with `home` mapped to the OS home directory.

## Runtime behavior
- Telegraf long-polling fetches updates in batches and runs handlers concurrently for each batch.
- Prompt handling runs out-of-band so the Telegraf handler can return immediately.
- The bot enforces one in-flight prompt per chat. Extra messages in the same chat receive a "previous message" reply (unless OpenCode is waiting on a `question` tool answer).
- Telegraf handler timeouts only log errors. Prompt timeouts are enforced by the bot and abort the HTTP request.
- OpenCode permission + question requests are surfaced via the event stream and answered in Telegram.

## Prompt flow mental model
- The Telegraf handler validates the message, acquires a per-chat lock, and returns immediately.
- A background task sends the prompt to OpenCode and later replies via `bot.telegram.sendMessage` with `reply_parameters`.
- If a prompt exceeds the bot timeout, the request is aborted, the lock is released, and a timeout reply is sent.
- If a prompt is already in flight for a chat, new messages are ignored with a "previous message" reply (unless OpenCode is waiting on a `question` tool answer).
- Session reuse is keyed by `chat_id + project_dir`, and the session id mapping is persisted in SQLite.
- The per-chat lock is released either when the background prompt completes (in a `finally` block) or when the prompt timeout fires.

## Event stream model
- A single global OpenCode event stream is opened on startup and shared across all sessions.
- Events include `sessionID` and `directory`, which are mapped back to the owning chat.
- Permission requests are sent to Telegram with inline buttons, and callback replies are forwarded to OpenCode.
- Question requests (`question` tool) are sent to Telegram with numbered option buttons; if the user types a message instead, it is treated as the question answer.

## Bot commands
- `/start` - confirm the bot is online.
- `/project list` - list project aliases (active project marked with `*`).
- `/project current` - show the active project alias and path.
- `/project add <alias> <path>` - add a project alias.
- `/project remove <alias>` - remove a project alias.
- `/project set <alias>` - set the active project alias for this chat.
- `/model` - show the active model for this chat (after the first reply).
- `/model list` - list available models from the OpenCode server.
- `/model set <provider>/<model>` - set the active model for this chat.
- `/status` - show current project/model/session status.
- `/abort` - abort the in-flight prompt for this chat.
- `/reset` - reset the OpenCode session for the active project.
- `/reboot` - restart the OpenCode service and clear cached sessions (requires `OPENCODE_RESTART_COMMAND`).
- `/restart` - restart the Telegram bridge (requires `OPENCODE_BRIDGE_RESTART_COMMAND`).

Note: `/reboot` clears the local session-id mapping because we do not yet know
whether `opencode serve` reliably persists and restores sessions across restarts.
Revisit this behavior once persistence is understood and verified.

When new commands are added or changed, update this list and the command descriptions.

## Next task
- Decide whether to add Docker packaging and release instructions.

## Coding guidelines
- Use custom error types instead of generic errors for better and cleaner error handling.

## Useful commands
- Install dependencies: `npm install`
- Install docs site deps: `pip install mkdocs-material`
- Bun smoke test (sqlite stores): `~/.bun/bin/bun scripts/bun-smoke.ts`
- Run setup wizard: `opencode-telegram-bridge setup`
- Start dev bot (watch mode): `npm run dev`
- Build: `npm run build`
- Run built bot: `npm start`
- Typecheck: `npm run typecheck`
- Run tests: `npm test`
- Run tests in watch mode: `npm run test:watch`
- Run test coverage: `npm run test:coverage`
- Serve docs site: `mkdocs serve`
- Build docs site: `mkdocs build`

## Docs hosting
- GitHub Pages deploys the MkDocs site from `docs/` on pushes to `main`.
- URL: https://gabriel-trigo.github.io/opencode-telegram-bridge/
- Add a changeset: `npx changeset`
- Version release: `npm run version`
- Publish release: `npm run release`

## Tests and validation
- Run the test suite with `npm test`.
- Validate changes by running `npm run typecheck`, `npm test`, and `npm run build`.

## Unit test guidance
- Add tests only when they verify meaningful behavior (config parsing, auth allowlist, event handling, error paths).
- Avoid tests that only duplicate TypeScript or library behavior.
- Prefer small, deterministic tests over end-to-end coverage.
- New or changed core logic should be covered by unit tests where practical.
