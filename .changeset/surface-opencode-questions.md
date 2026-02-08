---
"opencode-telegram-bridge": minor
---

Surface OpenCode `question` tool requests in Telegram.

- Listen for `question.asked` events and show questions with numbered option buttons.
- Treat the user's next message as the question answer when a question is pending.
- Improve prompt timeout diagnostics with structured JSON logs.
