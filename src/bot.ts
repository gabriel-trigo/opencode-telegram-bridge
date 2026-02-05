import { exec } from "node:child_process"
import { promisify } from "node:util"

import { Markup, Telegraf } from "telegraf"
import { message } from "telegraf/filters"

import type { BotConfig, RestartCommandConfig } from "./config.js"
import type { OpencodeBridge, PermissionReply, PromptInput } from "./opencode.js"
import { createPromptGuard } from "./prompt-guard.js"
import { HOME_PROJECT_ALIAS, type ProjectStore } from "./projects.js"
import type { ChatModelStore, ChatProjectStore } from "./state.js"
import { splitTelegramMessage } from "./telegram.js"
import {
  DEFAULT_MAX_IMAGE_BYTES,
  TelegramImageTooLargeError,
  downloadTelegramImageAsAttachment,
  isImageDocument,
  pickLargestPhoto,
} from "./telegram-image.js"
import {
  buildPermissionKeyboardSpec,
  buildPermissionSummary,
  formatCommandOutput,
  formatModelList,
  formatPermissionDecision,
  formatProjectList,
  formatUserLabel,
  isAuthorized,
  isCommandMessage,
  parseModelCommand,
  parsePermissionCallback,
  parseProjectCommand,
  type ModelProvider,
  type PermissionKeyboardSpec,
} from "./bot-logic.js"

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

export const toTelegrafInlineKeyboard = (spec: PermissionKeyboardSpec) => {
  const buttons = spec.buttons.map((button) =>
    Markup.button.callback(button.text, button.data),
  )
  return Markup.inlineKeyboard([buttons])
}

export const startBot = (
  config: BotConfig,
  opencode: OpencodeBridge,
  projects: ProjectStore,
  chatProjects: ChatProjectStore,
  chatModels: ChatModelStore,
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

  const buildBotCommands = () => {
    const commands = [
      { command: "start", description: "Confirm the bot is online" },
      {
        command: "project",
        description: "Manage project aliases (list/current/add/remove/set)",
      },
      { command: "model", description: "Show or list available models" },
      { command: "reset", description: "Reset the active project session" },
      { command: "abort", description: "Abort the in-flight prompt" },
    ]

    if (config.opencodeRestart) {
      commands.push({
        command: "reboot",
        description: "Restart OpenCode and clear cached sessions",
      })
    }

    if (config.bridgeRestart) {
      commands.push({
        command: "restart",
        description: "Restart the Telegram bridge",
      })
    }

    return commands
  }

  const runRestartCommand = async (
    restartConfig: RestartCommandConfig | undefined,
  ): Promise<RestartResult> => {
    if (!restartConfig) {
      return { configured: false }
    }

    try {
      const result = await execAsync(restartConfig.command, {
        timeout: restartConfig.timeoutMs,
      })
      return {
        configured: true,
        stdout: formatCommandOutput(result.stdout),
        stderr: formatCommandOutput(result.stderr),
      }
    } catch (error) {
      const failure = error as Error & {
        signal?: string
        stdout?: string
        stderr?: string
      }
      if (failure.signal === "SIGTERM") {
        return {
          configured: true,
          stdout: formatCommandOutput(failure.stdout),
          stderr: formatCommandOutput(failure.stderr),
        }
      }

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
        const replyMarkup = toTelegrafInlineKeyboard(
          buildPermissionKeyboardSpec(request.id, request.always.length > 0),
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

  const getProjectForChat = (chatId: number) => {
    const activeAlias = getChatProjectAlias(chatId)
    const project = projects.getProject(activeAlias)
    if (!project) {
      throw new Error("Missing project configuration.")
    }
    return project
  }

  const runPrompt = (
    ctx: {
      from?: unknown
      chat?: { id?: number } | undefined
      message?: { message_id?: number } | undefined
      reply: (text: string) => Promise<unknown>
    },
    userLabel: string,
    input: PromptInput,
  ) => {
    const chatId = ctx.chat?.id
    const replyToMessageId = ctx.message?.message_id
    if (!chatId) {
      console.warn("Missing chat id for incoming message", { userLabel })
      void ctx.reply("Missing chat context.")
      return
    }

    let project
    try {
      project = getProjectForChat(chatId)
    } catch (error) {
      console.error("Missing project for chat", { chatId, error })
      void ctx.reply("Missing project configuration.")
      return
    }

    let timedOut = false
    const abortController = promptGuard.tryStart(chatId, replyToMessageId, () => {
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
        const sessionId = await opencode.ensureSessionId(chatId, project.path)
        promptGuard.setSessionId(chatId, abortController, sessionId)
        const storedModel = chatModels.getModel(chatId, project.path)
        const promptOptions = storedModel
          ? { signal: abortController.signal, model: storedModel, sessionId }
          : { signal: abortController.signal, sessionId }
        const result = await opencode.promptFromChat(
          chatId,
          input,
          project.path,
          promptOptions,
        )
        if (!storedModel && result.model) {
          chatModels.setModel(chatId, project.path, result.model)
        }
        if (!timedOut) {
          await sendReply(chatId, replyToMessageId, result.reply)
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        console.error("Failed to send prompt to OpenCode", error)
        if (!timedOut) {
          const message =
            error instanceof Error &&
            error.message.includes("does not support image input")
              ? error.message
              : "OpenCode error. Check server logs."
          await sendReply(chatId, replyToMessageId, message)
        }
      } finally {
        promptGuard.finish(chatId)
      }
    })()
  }

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
    const { subcommand, args } = parseProjectCommand(messageText)

    try {
      switch (subcommand) {
        case "list": {
          await ctx.reply(
            formatProjectList(projects.listProjects(), getChatProjectAlias(chatId)),
          )
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

  bot.command("model", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const chatId = ctx.chat?.id
    if (!chatId) {
      console.warn("Missing chat id for incoming model command")
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

    const messageText = ctx.message?.text ?? ""
    const { subcommand } = parseModelCommand(messageText)

    try {
      switch (subcommand) {
        case "list": {
          const providers = await opencode.listModels(project.path)
          await sendReply(
            chatId,
            ctx.message?.message_id,
            formatModelList(providers as unknown as ModelProvider[]),
          )
          return
        }
        case "current": {
          const model = chatModels.getModel(chatId, project.path)
          if (!model) {
            await ctx.reply(
              "Model unavailable. This chat hasn't started a session yet, so the model can't be determined.",
            )
            return
          }

          await ctx.reply(`Current model: ${model.providerID}/${model.modelID}`)
          return
        }
        default: {
          await ctx.reply("Usage: /model [list]")
        }
      }
    } catch (error) {
      console.error("Failed to handle /model command", error)
      const message =
        error instanceof Error
          ? error.message
          : "Model command failed. Check server logs."
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
    chatModels.clearModel(chatId, project.path)
    if (didReset) {
      await ctx.reply(`Session reset for ${project.alias}.`)
      return
    }

    await ctx.reply(`No active session to reset for ${project.alias}.`)
  })

  bot.command("abort", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const chatId = ctx.chat?.id
    if (!chatId) {
      console.warn("Missing chat id for incoming abort command")
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

    const aborted = promptGuard.abort(chatId)
    if (!aborted) {
      await ctx.reply("No in-flight prompt to abort.")
      return
    }

    await sendReply(
      chatId,
      aborted.replyToMessageId,
      "Aborting response to this prompt...",
    )

    if (aborted.sessionId) {
      try {
        await opencode.abortSession(aborted.sessionId, project.path)
      } catch (error) {
        console.error("Failed to abort OpenCode session", error)
      }
    }
  })

  bot.command("reboot", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    const result = await runRestartCommand(config.opencodeRestart)
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
    chatModels.clearAll()

    if (result.stderr) {
      console.warn("OpenCode restart stderr", { stderr: result.stderr })
    }

    const stdout = result.stdout
    const detail = stdout ? `\n${stdout}` : ""
    await ctx.reply(`OpenCode restart triggered. Session cache cleared.${detail}`)
  })

  bot.command("restart", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    if (!config.bridgeRestart) {
      await ctx.reply(
        "Restart command not configured. Set OPENCODE_BRIDGE_RESTART_COMMAND to enable this.",
      )
      return
    }

    await ctx.reply("Restarting opencode-telegram-bridge...")

    const result = await runRestartCommand(config.bridgeRestart)
    if (!result.configured) {
      await ctx.reply(
        "Restart command not configured. Set OPENCODE_BRIDGE_RESTART_COMMAND to enable this.",
      )
      return
    }

    if (result.error) {
      console.error("Failed to restart opencode-telegram-bridge", result.error)
      const stderr = result.stderr
      const errorMessage = formatCommandOutput(result.error.message)
      const detail = stderr ?? errorMessage
      const suffix = detail ? `\n${detail}` : ""
      await ctx.reply(`Bridge restart failed.${suffix}`)
      return
    }

    if (result.stderr) {
      console.warn("Bridge restart stderr", { stderr: result.stderr })
    }
  })

  bot.on("callback_query", async (ctx) => {
    const callbackQuery = ctx.callbackQuery
    if (!callbackQuery || !("data" in callbackQuery)) {
      return
    }

    const data = callbackQuery.data
    const parsed = parsePermissionCallback(data)
    if (!parsed) {
      return
    }

    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.answerCbQuery("Not authorized.")
      return
    }

    const requestId = parsed.requestId
    const permissionReply = parsed.reply as PermissionReply

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
      const decisionLabel = formatPermissionDecision(permissionReply)
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

    if (ctx.message && isCommandMessage(ctx.message)) {
      return
    }

    const text = ctx.message.text
    const userLabel = formatUserLabel(ctx.from)

    console.log(`[telegram] ${userLabel}: ${text}`)

    runPrompt(ctx, userLabel, { text })
  })

  bot.on(message("photo"), async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    if (!ctx.message || !("photo" in ctx.message)) {
      return
    }

    if (isCommandMessage(ctx.message)) {
      return
    }

    const userLabel = formatUserLabel(ctx.from)
    const photos = ctx.message.photo
    const caption = ctx.message.caption ?? ""
    const largest = pickLargestPhoto(photos)

    try {
      const attachment = await downloadTelegramImageAsAttachment(
        ctx.telegram,
        largest.file_id,
        {
          mime: "image/jpeg",
          filename: "photo.jpg",
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          ...(largest.file_size != null ? { declaredSize: largest.file_size } : {}),
        },
      )

      const text = caption.trim()
        ? caption
        : "Please analyze the attached image."

      runPrompt(ctx, userLabel, {
        text,
        files: [
          {
            mime: attachment.mime,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            dataUrl: attachment.dataUrl,
          },
        ],
      })
    } catch (error) {
      console.error("Failed to handle Telegram photo", error)
      const message =
        error instanceof TelegramImageTooLargeError
          ? error.message
          : "Failed to process image."
      await ctx.reply(message)
    }
  })

  bot.on(message("document"), async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserId)) {
      await ctx.reply("Not authorized.")
      return
    }

    if (!ctx.message || !("document" in ctx.message)) {
      return
    }

    if (isCommandMessage(ctx.message)) {
      return
    }

    const userLabel = formatUserLabel(ctx.from)
    const document = ctx.message.document
    if (!isImageDocument(document)) {
      await ctx.reply("Unsupported document type. Please send an image.")
      return
    }

    const caption = ctx.message.caption ?? ""
    const mime = document.mime_type ?? "application/octet-stream"
    const filename = document.file_name
    try {
      const attachment = await downloadTelegramImageAsAttachment(
        ctx.telegram,
        document.file_id,
        {
          mime,
          ...(filename ? { filename } : {}),
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          ...(document.file_size != null
            ? { declaredSize: document.file_size }
            : {}),
        },
      )

      const text = caption.trim()
        ? caption
        : "Please analyze the attached image."

      runPrompt(ctx, userLabel, {
        text,
        files: [
          {
            mime: attachment.mime,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            dataUrl: attachment.dataUrl,
          },
        ],
      })
    } catch (error) {
      console.error("Failed to handle Telegram document", error)
      const message =
        error instanceof TelegramImageTooLargeError
          ? error.message
          : "Failed to process image."
      await ctx.reply(message)
    }
  })

  bot.catch((error, ctx) => {
    console.error("Telegram bot error", {
      error,
      updateId: ctx.update.update_id,
    })
  })

  bot.launch()
  const commands = buildBotCommands()
  void bot.telegram
    .setMyCommands(commands)
    .catch((error) => console.error("Failed to set bot commands", error))
  void bot.telegram
    .setMyCommands(commands, { scope: { type: "all_private_chats" } })
    .catch((error) =>
      console.error("Failed to set private chat commands", error),
    )
  return bot
}
