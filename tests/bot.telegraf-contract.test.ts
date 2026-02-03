import { describe, expect, it } from "vitest"

import { toTelegrafInlineKeyboard } from "../src/bot.js"
import { buildPermissionKeyboardSpec } from "../src/bot-logic.js"

describe("Telegraf Markup contract", () => {
  it("converts our internal button model to Telegraf inline keyboard shape", () => {
    const spec = buildPermissionKeyboardSpec("req-1", true)
    const keyboard = toTelegrafInlineKeyboard(spec)

    // Telegraf's inline keyboard uses reply_markup.inline_keyboard
    const inline = (keyboard as { reply_markup?: unknown }).reply_markup as {
      inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
    }

    expect(inline.inline_keyboard?.[0]?.map((b) => b.text)).toEqual([
      "Approve once",
      "Approve always",
      "Reject",
    ])
    expect(inline.inline_keyboard?.[0]?.map((b) => b.callback_data)).toEqual([
      "perm:req-1:once",
      "perm:req-1:always",
      "perm:req-1:reject",
    ])
  })
})
