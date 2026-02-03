# OpenCode Telegram Bridge

[![CI](https://github.com/gabriel-trigo/opencode-telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/gabriel-trigo/opencode-telegram-bridge/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/opencode-telegram-bridge.svg)](https://www.npmjs.com/package/opencode-telegram-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Run a Telegram bot that forwards messages to an OpenCode server and returns responses.

## Installation (users)

This project is currently Linux-only (it is designed to run as a long-running `systemd` service).

Prereqs: Node.js 18+, OpenCode CLI on PATH, and an OpenCode server running (`opencode serve`).

Recommended: use the installation wizard to set this up as a `systemd` daemon.

```bash
npm install -g opencode-telegram-bridge
opencode-telegram-bridge setup
```

The wizard is the easiest and recommended path; it writes the systemd unit and
env file for you and starts the service.

For required environment variables and systemd setup, see:
- [docs/installation.md](docs/installation.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/systemd.md](docs/systemd.md)

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
