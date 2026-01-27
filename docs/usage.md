# Usage

## Bot commands
- `/start` - confirm the bot is online.
- `/project list` - list project aliases (active project marked with `*`).
- `/project current` - show the active project alias and path.
- `/project add <alias> <path>` - add a project alias.
- `/project remove <alias>` - remove a project alias.
- `/project set <alias>` - set the active project alias for this chat.
- `/reset` - reset the OpenCode session for the active project.

## Notes
- Only one prompt is processed at a time per chat.
- Permission requests show inline buttons in Telegram.

## CLI
If installed via npm, start the bot with:
```bash
opencode-telegram-bridge
```
