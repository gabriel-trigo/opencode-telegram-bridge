# OpenCode Telegram Bridge

Run a Telegram bot that forwards messages to an OpenCode backend and returns responses.

## Requirements
- Node.js 18+
- OpenCode CLI installed and available on PATH
- OpenCode server running (`opencode serve`)

## Install (for users)
```bash
npm install -g opencode-telegram-bridge
```

Run:
```bash
opencode-telegram-bridge
```

You still need OpenCode running separately:
```bash
opencode serve
```

## Documentation
See the docs for configuration, usage, and systemd setup:
https://gabriel-trigo.github.io/opencode-telegram-bridge/
