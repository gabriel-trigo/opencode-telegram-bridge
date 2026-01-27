# Installation

## Prerequisites
- Node.js 18+
- OpenCode CLI installed and available on PATH (see https://opencode.ai/docs/cli/)

## Install dependencies
```bash
npm install
```

## Start OpenCode server
```bash
opencode serve
```

## Configure environment
Copy the example file and fill in values:
```bash
cp .env.example .env
```

## Run the bot
```bash
npm run dev
```

For production, build and run:
```bash
npm run build
npm start
```

## Install via npm
```bash
npm install -g opencode-telegram-bridge
```

Run:
```bash
opencode-telegram-bridge
```
