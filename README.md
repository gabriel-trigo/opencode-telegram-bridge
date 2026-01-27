# OpenCode Telegram Bridge

Run a Telegram bot that forwards messages to an OpenCode backend and returns responses.

## Requirements
- Node.js 18+
- OpenCode CLI installed and available on PATH
- OpenCode server running (`opencode serve`)

## Quickstart
1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Start OpenCode server in another terminal:

```bash
opencode serve
```

4. Run the bot:

```bash
npm run dev
```

## Install via npm
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

## Docs
- `docs/index.md`
- `docs/installation.md`
- `docs/configuration.md`
- `docs/usage.md`
- `docs/systemd.md`
- `docs/release.md`

## Notes
- Project aliases and chat project selection are stored in `~/.opencode-telegram-bridge/projects.db`.
