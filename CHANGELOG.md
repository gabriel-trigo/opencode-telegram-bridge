# opencode-telegram-bridge

## 1.0.4

### Patch Changes

- f23c471: Add /reboot-bridge to restart the Telegram bridge via a configurable command.
- 6778878: Register Telegram bot commands on startup to enable autocomplete.

## 1.0.3

### Patch Changes

- b8ebe71: Add the /reboot command for restarting OpenCode and improve changeset checks on main pushes.

## Unreleased

### Patch Changes

- Add `/reboot` command to restart OpenCode and clear cached session mappings.
- Fix changeset enforcement on main pushes by diffing the GitHub event range.

## 1.0.2

### Patch Changes

- f22f103: Switch release workflow to npm trusted publishing (OIDC)

## 1.0.1

### Patch Changes

- a641f11: Tighten README layout and document lean docs guidance
- 2d643ab: Added release workflow documentation, scripts, and dependencies
- a5916f9: Add permission bit to bin/opencode-telegram-bridge.js to prepare npm publish
