import { Telegraf } from "telegraf"

import type { BotConfig } from "./config.js"

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

export const startBot = (config: BotConfig) => {
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

    console.log(`[telegram] ${userLabel}: ${text}`)
    await ctx.reply("Received. Logged on server.")
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
