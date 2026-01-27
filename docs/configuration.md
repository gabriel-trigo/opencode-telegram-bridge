# Configuration

Set these environment variables in `.env` or in your service environment.

## Required
- `TELEGRAM_BOT_TOKEN` - Telegram bot token.
- `TELEGRAM_ALLOWED_USER_ID` - Telegram user ID allowed to use the bot.
- `OPENCODE_SERVER_URL` - OpenCode server URL (default server is `http://127.0.0.1:4096`).

## Optional
- `OPENCODE_SERVER_USERNAME` - Basic auth username (default: `opencode`).
- `OPENCODE_SERVER_PASSWORD` - Basic auth password.
- `OPENCODE_PROMPT_TIMEOUT_MS` - Prompt timeout in milliseconds (default: 600000).
- `TELEGRAM_HANDLER_TIMEOUT_MS` - Telegraf handler timeout in milliseconds (default: prompt timeout + 30000).

## Data storage
- Project aliases and chat selections are stored in `~/.opencode-telegram-bridge/projects.db`.
