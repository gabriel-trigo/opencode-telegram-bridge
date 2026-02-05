# opencode-telegram-bridge

## 1.3.0

### Minor Changes

- 7ed6c9c: Add support for sending a single Telegram image (photo or image document) as a prompt to OpenCode.

## 1.2.4

### Patch Changes

- 42ac371: Add /abort command to cancel an in-flight prompt and stop backend processing.

## 1.2.3

### Patch Changes

- 0012c1d: Add macOS launchd support to the setup wizard and docs.

## 1.2.2

### Patch Changes

- 13fcfbe: Improve docs setup guidance, branding assets, OSS metadata, and coverage thresholds.
- d4c4367: Improve test coverage and harden bot behavior validation.

## 1.2.1

### Patch Changes

- f45329d: Harden setup wizard secret handling and linger messaging.

## 1.2.0

### Minor Changes

- eb7615d: Allow the setup wizard to install an OpenCode user service.

## 1.1.1

### Patch Changes

- a305ef7: Pin the Node binary in systemd user units.

## 1.1.0

### Minor Changes

- ec12ca8: Add a setup wizard and default to user systemd services.

## 1.0.8

### Patch Changes

- 9b398c8: Exclude AGENTS.md from changeset enforcement.

## 1.0.7

### Patch Changes

- 6bcc874: Register bot commands for private chats.

## 1.0.6

### Patch Changes

- 040b737: Add /model commands and persist model selection per chat project.

## 1.0.5

### Patch Changes

- 67ba6ee: Add MkDocs Material configuration to serve docs as a website.
- e44f980: Deploy MkDocs docs site to GitHub Pages via GitHub Actions.
- 05606bc: Ignore local MkDocs build output directory.
- f91c4e1: Rename the bridge restart command to /restart to avoid Telegram parsing issues.

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
