# launchd Service (macOS user)

This project ships launchd templates in `launchd/` for manual setup on macOS.

## Recommended: setup wizard
```bash
opencode-telegram-bridge setup
```

This is the recommended path. It writes the launchd plist and env file for your
machine and starts the service for you.

## Advanced: manual install
Only use this if you cannot run the wizard. It is easy to misconfigure paths
or environment values and end up with a service that does not start.

1. Install the package:

```bash
npm install -g opencode-telegram-bridge
```

2. Locate the installed package so you can copy the bundled launchd files:

```bash
npm root -g
```

The launchd templates live at:

```text
<npm root -g>/opencode-telegram-bridge/launchd/
```

3. Copy the launchd plist:

```bash
mkdir -p ~/Library/LaunchAgents
cp "$(npm root -g)/opencode-telegram-bridge/launchd/opencode-telegram-bridge.plist" \
  ~/Library/LaunchAgents/com.opencode.telegram-bridge.plist
```

4. Edit the plist:

- Replace `/path/to/node` with `command -v node`.
- Replace `/path/to/opencode-telegram-bridge/dist/cli.js` with:

```bash
echo "$(npm root -g)/opencode-telegram-bridge/dist/cli.js"
```

- Replace `REPLACE_ME` values with your Telegram credentials.
- Replace `~/Library/Logs/...` with absolute paths (launchd does not expand `~`).

5. Load and start:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opencode.telegram-bridge.plist
launchctl enable gui/$(id -u)/com.opencode.telegram-bridge
launchctl kickstart -k gui/$(id -u)/com.opencode.telegram-bridge
```

## Optional: OpenCode server agent
If you want `opencode serve` to run as a launchd agent too:

```bash
cp "$(npm root -g)/opencode-telegram-bridge/launchd/opencode-server.plist" \
  ~/Library/LaunchAgents/com.opencode.server.plist
```

Edit the plist:
- Replace `/path/to/opencode` with `command -v opencode`.
- Replace `/path/to/node/dir` with `dirname "$(command -v node)"`.
- Replace `~/Library/Logs/...` with absolute paths.

Then load and start:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opencode.server.plist
launchctl enable gui/$(id -u)/com.opencode.server
launchctl kickstart -k gui/$(id -u)/com.opencode.server
```

## Logs
```bash
tail -f ~/Library/Logs/opencode-telegram-bridge.log
```

## Start on boot (optional)
LaunchAgents start on login. To start before login, use a LaunchDaemon (requires sudo).
