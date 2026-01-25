import { Telegraf } from "telegraf"

import type { BotConfig } from "./config.js"
import type { OpencodeBridge } from "./opencode.js"
import { HOME_PROJECT_ALIAS, type ProjectStore } from "./projects.js"

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

export const startBot = (
  config: BotConfig,
  opencode: OpencodeBridge,
  projects: ProjectStore,
) => {
  const bot = new Telegraf(config.botToken)
  const chatProjects = new Map<number, string>()

  const getChatProjectAlias = (chatId: number) =>
    chatProjects.get(chatId) ?? HOME_PROJECT_ALIAS

  const setChatProjectAlias = (chatId: number, alias: string) => {
    chatProjects.set(chatId, alias)
  }

  const formatProjectList = (activeAlias: string) => {
    const entries = projects.listProjects()
    if (entries.length === 0) {
      return "No projects configured."
    }

    const lines = entries.map((entry) => {
      const prefix = entry.alias === activeAlias ? "*" : " "
      return `${prefix} ${entry.alias}: ${entry.path}`
    })

    return ["Projects (active marked with *):", ...lines].join("\n")
  }

  const isCommandMessage = (ctx: { message?: { entities?: Array<{ type: string; offset: number }> } }) =>
    ctx.message?.entities?.some(
      (entity) => entity.type === "bot_command" && entity.offset === 0,
    ) ?? false

  bot.start(async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    await ctx.reply("Bot is online. Send me a message and I'll log it here.")
  })

  bot.command("project", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const chatId = ctx.chat?.id
    if (!chatId) {
      console.warn("Missing chat id for incoming project command")
      await ctx.reply("Missing chat context.")
      return
    }

    const messageText = ctx.message?.text ?? ""
    const parts = messageText.trim().split(/\s+/)
    parts.shift()

    const subcommand = parts[0] ?? "list"
    const args = parts.slice(1)

    try {
      switch (subcommand) {
        case "list": {
          await ctx.reply(formatProjectList(getChatProjectAlias(chatId)))
          return
        }
        case "current": {
          const activeAlias = getChatProjectAlias(chatId)
          const project = projects.getProject(activeAlias)
          if (!project) {
            throw new Error(`Project alias '${activeAlias}' not found`)
          }

          await ctx.reply(`${project.alias}: ${project.path}`)
          return
        }
        case "add": {
          const alias = args[0]
          const projectPath = args.slice(1).join(" ")
          if (!alias) {
            await ctx.reply("Usage: /project add <alias> <path>")
            return
          }

          const project = projects.addProject(alias, projectPath)
          await ctx.reply(`Added ${project.alias}: ${project.path}`)
          return
        }
        case "remove": {
          const alias = args[0]
          if (!alias) {
            await ctx.reply("Usage: /project remove <alias>")
            return
          }

          projects.removeProject(alias)
          if (getChatProjectAlias(chatId) === alias) {
            setChatProjectAlias(chatId, HOME_PROJECT_ALIAS)
          }
          await ctx.reply(`Removed ${alias}`)
          return
        }
        case "set": {
          const alias = args[0]
          if (!alias) {
            await ctx.reply("Usage: /project set <alias>")
            return
          }

          const project = projects.getProject(alias)
          if (!project) {
            throw new Error(`Project alias '${alias}' not found`)
          }

          setChatProjectAlias(chatId, project.alias)
          await ctx.reply(`Active project: ${project.alias}`)
          return
        }
        default: {
          await ctx.reply(
            "Usage: /project <list|current|add|remove|set> ...",
          )
        }
      }
    } catch (error) {
      console.error("Failed to handle /project command", error)
      const message =
        error instanceof Error
          ? error.message
          : "Project command failed. Check server logs."
      await ctx.reply(message)
    }
  })

  bot.command("reset", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const chatId = ctx.chat?.id
    if (!chatId) {
      console.warn("Missing chat id for incoming reset command")
      await ctx.reply("Missing chat context.")
      return
    }

    const activeAlias = getChatProjectAlias(chatId)
    const project = projects.getProject(activeAlias)
    if (!project) {
      console.error("Missing project for chat", { chatId, activeAlias })
      await ctx.reply("Missing project configuration.")
      return
    }

    const didReset = opencode.resetSession(chatId, project.path)
    if (didReset) {
      await ctx.reply(`Session reset for ${project.alias}.`)
      return
    }

    await ctx.reply(`No active session to reset for ${project.alias}.`)
  })

  bot.on("text", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    if (isCommandMessage(ctx)) {
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

    const activeAlias = getChatProjectAlias(chatId)
    const project = projects.getProject(activeAlias)
    if (!project) {
      console.error("Missing project for chat", { chatId, activeAlias })
      await ctx.reply("Missing project configuration.")
      return
    }

    console.log(`[telegram] ${userLabel}: ${text}`)

    try {
      const reply = await opencode.promptFromChat(
        chatId,
        text,
        project.path,
      )
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
