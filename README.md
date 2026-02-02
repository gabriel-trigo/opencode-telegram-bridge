# OpenCode Telegram Bridge

Run a Telegram bot that forwards messages to an OpenCode server and returns responses.

## Installation (users)

This project is currently Linux-only (it is designed to run as a long-running `systemd` service).

Prereqs: Node.js 18+, OpenCode CLI on PATH, and an OpenCode server running (`opencode serve`).

Recommended: use the installation wizard to set this up as a `systemd` daemon.

```bash
npm install -g opencode-telegram-bridge
opencode-telegram-bridge
```

For required environment variables and systemd setup, see:
- docs/installation.md
- docs/configuration.md
- docs/systemd.md

## Installation (developers)

```bash
git clone https://github.com/gabriel-trigo/opencode-telegram-bridge.git
cd opencode-telegram-bridge
npm install
cp .env.example .env
```

In one terminal:
```bash
opencode serve
```

In another terminal:
```bash
npm run dev
```
