# OpenCode Telegram Bridge

## Project goal
Run a Telegram bot that forwards messages to an OpenCode backend and returns responses. The MVP focuses on reliable message intake, allowlisted access, and clean service operation with text-only request/response.

## Architecture
- Run OpenCode in server mode (`opencode serve`) on the same host, bound to localhost.
- A long-running Telegram bot process translates Telegram messages into OpenCode SDK calls.
- Each Telegram chat reuses an OpenCode session per project, with session ids persisted in SQLite by chat id and project path.
- Project aliases and chat project selection persist in SQLite at `~/.opencode-telegram-bridge/projects.db`, with `home` mapped to the OS home directory.

## Runtime behavior
- Telegraf long-polling fetches updates in batches and runs handlers concurrently for each batch.
- Prompt handling runs out-of-band so the Telegraf handler can return immediately.
- The bot enforces one in-flight prompt per chat. Extra messages in the same chat receive a "previous message" reply.
- Telegraf handler timeouts only log errors. Prompt timeouts are enforced by the bot and abort the HTTP request.
- OpenCode permission requests are surfaced via the event stream and answered with Telegram inline buttons.

## Prompt flow mental model
- The Telegraf handler validates the message, acquires a per-chat lock, and returns immediately.
- A background task sends the prompt to OpenCode and later replies via `bot.telegram.sendMessage` with `reply_parameters`.
- If a prompt exceeds the bot timeout, the request is aborted, the lock is released, and a timeout reply is sent.
- If a prompt is already in flight for a chat, new messages are ignored with a "previous message" reply.
- Session reuse is keyed by `chat_id + project_dir`, and the session id mapping is persisted in SQLite.
- The per-chat lock is released either when the background prompt completes (in a `finally` block) or when the prompt timeout fires.

## Event stream model
- A single global OpenCode event stream is opened on startup and shared across all sessions.
- Events include `sessionID` and `directory`, which are mapped back to the owning chat.
- Permission requests are sent to Telegram with inline buttons, and callback replies are forwarded to OpenCode.

## Bot commands
- `/start` - confirm the bot is online.
- `/project list` - list project aliases (active project marked with `*`).
- `/project current` - show the active project alias and path.
- `/project add <alias> <path>` - add a project alias.
- `/project remove <alias>` - remove a project alias.
- `/project set <alias>` - set the active project alias for this chat.
- `/reset` - reset the OpenCode session for the active project.

When new commands are added or changed, update this list and the command descriptions.

## Next task
- Decide whether to add Docker packaging and release instructions.

## Useful commands
- Install dependencies: `npm install`
- Start dev bot (watch mode): `npm run dev`
- Build: `npm run build`
- Run built bot: `npm start`
- Typecheck: `npm run typecheck`
- Run tests: `npm test`
- Run tests in watch mode: `npm run test:watch`
- Run test coverage: `npm run test:coverage`
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
