import { exec } from "node:child_process"
import { promisify } from "node:util"

import { Markup, Telegraf } from "telegraf"

import type { BotConfig } from "./config.js"
import type { OpencodeBridge, PermissionReply } from "./opencode.js"
import { createPromptGuard } from "./prompt-guard.js"
import { HOME_PROJECT_ALIAS, type ProjectStore } from "./projects.js"
import type { ChatProjectStore } from "./state.js"
import { splitTelegramMessage } from "./telegram.js"

type TelegramUser = {
  id?: number
  username?: string
}

type PendingPermission = {
  chatId: number
  messageId: number
  directory: string
  summary: string
}

type RestartResult =
  | { configured: false }
  | {
      configured: true
      stdout: string | null
      stderr: string | null
      error?: Error
    }

const execAsync = promisify(exec)

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
  chatProjects: ChatProjectStore,
) => {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: config.handlerTimeoutMs,
  })
  /*
   * Telegraf wraps each update handler in a timeout. When that timeout fires,
   * it logs an error but does not cancel the async handler. To avoid dangling
   * prompts and a stuck in-flight lock, we enforce our own per-chat timeout
   * and abort the OpenCode request when it exceeds the limit.
   */
  const promptGuard = createPromptGuard(config.promptTimeoutMs)
  const pendingPermissions = new Map<string, PendingPermission>()

  const sendReply = async (
    chatId: number,
    replyToMessageId: number | undefined,
    text: string,
  ) => {
    try {
      const chunks = splitTelegramMessage(text)
      for (const [index, chunk] of chunks.entries()) {
        const replyParameters =
          index === 0 && replyToMessageId
            ? { reply_parameters: { message_id: replyToMessageId } }
            : undefined
        await bot.telegram.sendMessage(chatId, chunk, replyParameters)
      }
    } catch (error) {
      console.error("Failed to send Telegram reply", error)
    }
  }

  const buildPermissionSummary = (request: {
    permission: string
    patterns: Array<string>
    always: Array<string>
  }) => {
    const lines = ["OpenCode permission request", `Permission: ${request.permission}`]
    if (request.patterns.length > 0) {
      lines.push(`Patterns: ${request.patterns.join(", ")}`)
    }
    if (request.always.length > 0) {
      lines.push(`Always scopes: ${request.always.join(", ")}`)
    }

    return lines.join("\n")
  }

  const buildPermissionKeyboard = (
    requestId: string,
    includeAlways: boolean,
  ) => {
    const buttons = [
      Markup.button.callback("Approve once", `perm:${requestId}:once`),
      Markup.button.callback("Reject", `perm:${requestId}:reject`),
    ]
    if (includeAlways) {
      buttons.splice(
        1,
        0,
        Markup.button.callback("Approve always", `perm:${requestId}:always`),
      )
    }

    return Markup.inlineKeyboard([buttons])
  }

  const buildBotCommands = () => {
    const commands = [
      { command: "start", description: "Confirm the bot is online" },
      {
        command: "project",
        description: "Manage project aliases (list/current/add/remove/set)",
      },
      { command: "reset", description: "Reset the active project session" },
    ]

    if (config.opencodeRestart) {
      commands.push({
        command: "reboot",
        description: "Restart OpenCode and clear cached sessions",
      })
    }

    return commands
  }

  const formatCommandOutput = (value: string | undefined) => {
    if (!value) {
      return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const maxLength = 800
    if (trimmed.length <= maxLength) {
      return trimmed
    }

    return `${trimmed.slice(0, maxLength)}...`
  }

  const restartOpencodeService = async (): Promise<RestartResult> => {
    if (!config.opencodeRestart) {
      return { configured: false }
    }

    try {
      const result = await execAsync(config.opencodeRestart.command, {
        timeout: config.opencodeRestart.timeoutMs,
      })
      return {
        configured: true,
        stdout: formatCommandOutput(result.stdout),
        stderr: formatCommandOutput(result.stderr),
      }
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string }
      return {
        configured: true,
        error: failure,
        stdout: formatCommandOutput(failure.stdout),
        stderr: formatCommandOutput(failure.stderr),
      }
    }
  }

  opencode.startPermissionEventStream({
    onPermissionAsked: async ({ request, directory }) => {
      const owner = opencode.getSessionOwner(request.sessionID)
      if (!owner) {
        console.warn("Permission request for unknown session", {
          sessionId: request.sessionID,
          requestId: request.id,
        })
        return
      }

      const summary = buildPermissionSummary(request)
      try {
        const replyMarkup = buildPermissionKeyboard(
          request.id,
          request.always.length > 0,
        )
        const message = await bot.telegram.sendMessage(owner.chatId, summary, {
          reply_markup: replyMarkup.reply_markup,
        })
        pendingPermissions.set(request.id, {
          chatId: owner.chatId,
          messageId: message.message_id,
          directory,
          summary,
        })
      } catch (error) {
        console.error("Failed to send permission request", error)
      }
    },
    onError: (error) => {
      console.error("OpenCode event stream error", error)
    },
  })

  const getChatProjectAlias = (chatId: number) =>
    chatProjects.getActiveAlias(chatId) ?? HOME_PROJECT_ALIAS

  const setChatProjectAlias = (chatId: number, alias: string) => {
    chatProjects.setActiveAlias(chatId, alias)
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

  bot.command("reboot", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const result = await restartOpencodeService()
    if (!result.configured) {
      await ctx.reply(
        "Restart command not configured. Set OPENCODE_RESTART_COMMAND to enable this.",
      )
      return
    }

    if (result.error) {
      console.error("Failed to restart OpenCode", result.error)
      const stderr = result.stderr
      const errorMessage = formatCommandOutput(result.error.message)
      const detail = stderr ?? errorMessage
      const suffix = detail ? `\n${detail}` : ""
      await ctx.reply(`OpenCode restart failed.${suffix}`)
      return
    }

    // Clear cached session mappings after a restart.
    // We do not yet know if opencode serve reliably restores sessions across restarts,
    // so we reset mappings to avoid reusing stale session IDs. Revisit if persistence
    // is confirmed stable.
    opencode.resetAllSessions()

    if (result.stderr) {
      console.warn("OpenCode restart stderr", { stderr: result.stderr })
    }

    const stdout = result.stdout
    const detail = stdout ? `\n${stdout}` : ""
    await ctx.reply(`OpenCode restart triggered. Session cache cleared.${detail}`)
  })

  bot.on("callback_query", async (ctx) => {
    const callbackQuery = ctx.callbackQuery
    if (!callbackQuery || !("data" in callbackQuery)) {
      return
    }

    const data = callbackQuery.data
    if (!data.startsWith("perm:")) {
      return
    }

    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.answerCbQuery("Not authorized.")
      return
    }

    const [, requestId, reply] = data.split(":")
    if (!requestId || !reply) {
      await ctx.answerCbQuery("Invalid permission response.")
      return
    }

    const permissionReply = reply as PermissionReply
    if (!(["once", "always", "reject"] as PermissionReply[]).includes(permissionReply)) {
      await ctx.answerCbQuery("Invalid permission response.")
      return
    }

    const pending = pendingPermissions.get(requestId)
    if (!pending) {
      await ctx.answerCbQuery("Permission request not found.")
      return
    }

    try {
      await opencode.replyToPermission(
        requestId,
        permissionReply,
        pending.directory,
      )
      pendingPermissions.delete(requestId)
      const decisionLabel =
        permissionReply === "reject"
          ? "Rejected"
          : permissionReply === "always"
          ? "Approved (always)"
          : "Approved (once)"
      await bot.telegram.editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        `${pending.summary}\nDecision: ${decisionLabel}`,
      )
      await ctx.answerCbQuery("Response sent.")
    } catch (error) {
      console.error("Failed to reply to permission", error)
      await ctx.answerCbQuery("Failed to send response.")
    }
  })

  bot.on("text", (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      void ctx.reply("Not authorized.")
      return
    }

    if (isCommandMessage(ctx)) {
      return
    }

    const text = ctx.message.text
    const userLabel = formatUserLabel(ctx.from)
    const chatId = ctx.chat?.id
    const replyToMessageId = ctx.message.message_id

    if (!chatId) {
      console.warn("Missing chat id for incoming message", { userLabel })
      void ctx.reply("Missing chat context.")
      return
    }

    const activeAlias = getChatProjectAlias(chatId)
    const project = projects.getProject(activeAlias)
    if (!project) {
      console.error("Missing project for chat", { chatId, activeAlias })
      void ctx.reply("Missing project configuration.")
      return
    }

    console.log(`[telegram] ${userLabel}: ${text}`)

    /*
     * If we cannot start a prompt, we reply to the new message and ignore it.
     * When a prompt times out, the guard clears the in-flight state so new
     * messages can be accepted even if the original handler is still running.
     */
    /*
     * timedOut becomes true only if our prompt timeout fires. Telegraf's
     * handler timeout does not stop background work, so we guard against
     * late replies by checking this flag before responding.
     */
    let timedOut = false
    const abortController = promptGuard.tryStart(chatId, () => {
      timedOut = true
      void sendReply(
        chatId,
        replyToMessageId,
        "OpenCode request timed out. You can send a new message.",
      )
    })

    if (!abortController) {
      void sendReply(
        chatId,
        replyToMessageId,
        "Your previous message has not been replied to yet. This message will be ignored.",
      )
      return
    }

    void (async () => {
      try {
        const reply = await opencode.promptFromChat(
          chatId,
          text,
          project.path,
          { signal: abortController.signal },
        )
        if (!timedOut) {
          await sendReply(chatId, replyToMessageId, reply)
        }
      } catch (error) {
        console.error("Failed to send prompt to OpenCode", error)
        if (!timedOut) {
          await sendReply(
            chatId,
            replyToMessageId,
            "OpenCode error. Check server logs.",
          )
        }
      } finally {
        promptGuard.finish(chatId)
      }
    })()
  })

  bot.catch((error, ctx) => {
    console.error("Telegram bot error", {
      error,
      updateId: ctx.update.update_id,
    })
  })

  bot.launch()
  void bot.telegram
    .setMyCommands(buildBotCommands())
    .catch((error) => console.error("Failed to set bot commands", error))
  return bot
}
