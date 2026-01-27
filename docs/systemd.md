# systemd Service (Linux)

This project ships a systemd unit template in `systemd/opencode-telegram-bridge.service`.

## Install
1. Build the project:

```bash
npm install
npm run build
```

2. Copy the service and env files:

```bash
sudo mkdir -p /etc/opencode-telegram-bridge
sudo cp systemd/opencode-telegram-bridge.service /etc/systemd/system/opencode-telegram-bridge.service
sudo cp systemd/opencode-telegram-bridge.env.example /etc/opencode-telegram-bridge.env
```

3. Edit the env file:

```bash
sudo nano /etc/opencode-telegram-bridge.env
```

4. Update the service paths if needed:

- `WorkingDirectory=/opt/opencode-telegram-bridge`
- `ExecStart=/usr/bin/node /opt/opencode-telegram-bridge/dist/index.js`

5. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-telegram-bridge
```

## Logs
```bash
sudo journalctl -u opencode-telegram-bridge -f
```
