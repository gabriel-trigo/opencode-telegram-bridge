import { Telegraf } from "telegraf"

import type { BotConfig } from "./config.js"
import type { OpencodeBridge } from "./opencode.js"

type TelegramUser = {
  id?: number
  username?: string
}

const isAuthorized = (user: TelegramUser | undefined, allowedUserId: number) =>
  user?.id === allowedUserId

const formatUserLabel = (user: TelegramUser | undefined) => {
  if (!user) {
    return "unknown"
  }

  if (user.username) {
    return `${user.username} (${user.id ?? "unknown"})`
  }

  return String(user.id ?? "unknown")
}

export const startBot = (config: BotConfig, opencode: OpencodeBridge) => {
  const bot = new Telegraf(config.botToken)

  bot.start(async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    await ctx.reply("Bot is online. Send me a message and I'll log it here.")
  })

  bot.on("text", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const text = ctx.message.text
    const userLabel = formatUserLabel(ctx.from)
    const chatId = ctx.chat?.id

    if (!chatId) {
      console.warn("Missing chat id for incoming message", { userLabel })
      await ctx.reply("Missing chat context.")
      return
    }

    console.log(`[telegram] ${userLabel}: ${text}`)

    try {
      const reply = await opencode.promptFromChat(chatId, text)
      await ctx.reply(reply)
    } catch (error) {
      console.error("Failed to send prompt to OpenCode", error)
      await ctx.reply("OpenCode error. Check server logs.")
    }
  })

  bot.catch((error, ctx) => {
    console.error("Telegram bot error", {
      error,
      updateId: ctx.update.update_id,
    })
  })

  bot.launch()
  return bot
}
