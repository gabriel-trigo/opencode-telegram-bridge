# OpenCode Telegram Bridge

[![CI](https://github.com/gabriel-trigo/opencode-telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/gabriel-trigo/opencode-telegram-bridge/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/opencode-telegram-bridge.svg)](https://www.npmjs.com/package/opencode-telegram-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Run a Telegram bot that forwards messages to an OpenCode server and returns responses.

## Installation (users)

This project supports Linux (systemd) and macOS (launchd) for long-running services.

Prereqs: Node.js 18+, OpenCode CLI on PATH, and an OpenCode server running (`opencode serve`).

Recommended: use the installation wizard to set this up as a service.

```bash
npm install -g opencode-telegram-bridge
opencode-telegram-bridge setup
```

The wizard is the easiest and recommended path; it writes the systemd/launchd
service definition and env file for you and starts the service.

For required environment variables and service setup, see:
- [docs/installation.md](docs/installation.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/systemd.md](docs/systemd.md)
- [docs/launchd.md](docs/launchd.md)

Contributing:
- [CONTRIBUTING.md](CONTRIBUTING.md)

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
