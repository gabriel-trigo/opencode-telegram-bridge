# Usage

## Bot commands
- `/start` - confirm the bot is online.
- `/project list` - list project aliases (active project marked with `*`).
- `/project current` - show the active project alias and path.
- `/project add <alias> <path>` - add a project alias.
- `/project remove <alias>` - remove a project alias.
- `/project set <alias>` - set the active project alias for this chat.
- `/model` - show the active model for this chat (after the first reply).
- `/model list` - list available models from the OpenCode server.
- `/model set <provider>/<model>` - set the active model for this chat.
- `/status` - show current project/model/session status.
- `/abort` - abort the in-flight prompt for this chat.
- `/reset` - reset the OpenCode session for the active project.
- `/reboot` - restart the OpenCode service and clear cached sessions (requires `OPENCODE_RESTART_COMMAND`).
- `/restart` - restart the Telegram bridge (requires `OPENCODE_BRIDGE_RESTART_COMMAND`).

## Notes
- Only one prompt is processed at a time per chat.
- Permission requests show inline buttons in Telegram.

## CLI
If installed via npm, start the bot with:
```bash
opencode-telegram-bridge
```
