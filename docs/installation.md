# Installation

## Prerequisites
- Node.js 18+
- OpenCode CLI installed and available on PATH (see https://opencode.ai/docs/cli/)
- OpenCode server running (`opencode serve`)

## Install
```bash
npm install -g opencode-telegram-bridge
```

## Setup (Linux systemd / macOS launchd)
```bash
opencode-telegram-bridge setup
```

The wizard can also set up OpenCode as a user service. It supports Linux systemd and macOS launchd.

See:
- [systemd](systemd.md)
- [launchd](launchd.md)

## Run the bot
```bash
opencode-telegram-bridge
```
