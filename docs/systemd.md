# systemd Service (Linux user)

This project ships a user systemd unit template in `systemd/opencode-telegram-bridge.service`.
On macOS, use the [launchd](launchd.md) guide instead.

## Recommended: setup wizard
```bash
opencode-telegram-bridge setup
```

This is the recommended and supported path. It writes the correct systemd unit
and env file for your machine (including the right Node/CLI paths), and starts
the service for you.

The wizard can optionally install a user service for `opencode serve` as well.

## Advanced: manual install
Only use this if you cannot run the wizard. It is easy to misconfigure paths
or environment values and end up with a service that does not start.
1. Install the package:

```bash
npm install -g opencode-telegram-bridge
```

2. Locate the installed package so you can copy the bundled systemd files:

```bash
npm root -g
```

This prints a path like `/usr/local/lib/node_modules` or `~/.nvm/versions/node/v20.x/lib/node_modules`.
The systemd files live at:

```text
<npm root -g>/opencode-telegram-bridge/systemd/
```

3. Copy the service and env files:

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/.config/opencode-telegram-bridge
cp "$(npm root -g)/opencode-telegram-bridge/systemd/opencode-telegram-bridge.service" \
  ~/.config/systemd/user/opencode-telegram-bridge.service
cp "$(npm root -g)/opencode-telegram-bridge/systemd/opencode-telegram-bridge.env.example" \
  ~/.config/opencode-telegram-bridge/opencode-telegram-bridge.env
```

4. Edit the env file:

```bash
nano ~/.config/opencode-telegram-bridge/opencode-telegram-bridge.env
```

5. Set the correct ExecStart path in the service file:

- The default is `ExecStart=/usr/bin/opencode-telegram-bridge`.
- Replace it with the output of:

```bash
command -v opencode-telegram-bridge
```

6. Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-telegram-bridge
```

## Start on boot (optional)
User services normally start on login. To run on boot without a login session:

```bash
sudo loginctl enable-linger $(whoami)
```

## Logs
```bash
journalctl --user -u opencode-telegram-bridge -f
```
