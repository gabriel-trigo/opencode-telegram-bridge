# systemd Service (Linux user)

This project ships a user systemd unit template in `systemd/opencode-telegram-bridge.service`.

## Recommended: setup wizard
```bash
opencode-telegram-bridge setup
```

The wizard can optionally install a user service for `opencode serve` as well.

## Manual install
1. Install the package:

```bash
npm install -g opencode-telegram-bridge
```

2. Copy the service and env files:

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/.config/opencode-telegram-bridge
cp systemd/opencode-telegram-bridge.service ~/.config/systemd/user/opencode-telegram-bridge.service
cp systemd/opencode-telegram-bridge.env.example ~/.config/opencode-telegram-bridge/opencode-telegram-bridge.env
```

3. Edit the env file:

```bash
nano ~/.config/opencode-telegram-bridge/opencode-telegram-bridge.env
```

4. Update the service path if needed:

- `ExecStart=/usr/bin/opencode-telegram-bridge`
- If you installed via npm in a non-standard location, set `ExecStart` to the output of `command -v opencode-telegram-bridge`.

5. Enable and start:

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
