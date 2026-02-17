import { exec } from "node:child_process"
import { promisify } from "node:util"

import type { QuestionRequest } from "@opencode-ai/sdk/v2"

import { Markup, Telegraf } from "telegraf"

import type { BotConfig, RestartCommandConfig } from "./config.js"
import type {
  LatestAssistantStats,
  OpencodeBridge,
  PermissionReply,
  PromptInput,
} from "./opencode.js"
import { createPromptGuard } from "./prompt-guard.js"
import { HOME_PROJECT_ALIAS, type ProjectStore } from "./projects.js"
import type { ChatModelStore, ChatProjectStore } from "./state.js"
import { splitTelegramMessage } from "./telegram.js"
import {
  DEFAULT_MAX_IMAGE_BYTES,
  TelegramImageTooLargeError,
  downloadTelegramFileAsAttachment,
  downloadTelegramImageAsAttachment,
  isImageDocument,
  isPdfDocument,
  pickLargestPhoto,
} from "./telegram-image.js"
import {
  OpencodeModelCapabilityError,
  OpencodeModelModalitiesError,
  OpencodeRequestError,
  ProjectAliasNotFoundError,
  ProjectConfigurationError,
  TelegramFileDownloadError,
  TelegramFileDownloadTimeoutError,
} from "./errors.js"
import {
  buildPermissionKeyboardSpec,
  buildPermissionSummary,
  formatCommandOutput,
  formatModelList,
  formatPermissionDecision,
  formatProjectList,
  formatStatusReply,
  formatUserLabel,
  isAuthorized,
  isCommandMessage,
  parseModelCommand,
  parsePermissionCallback,
  parseQuestionCallback,
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

type PendingQuestion = {
  chatId: number
  messageId: number
  directory: string
  request: QuestionRequest
  currentIndex: number
  answers: Array<Array<string> | null>
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

export const toTelegrafInlineKeyboard = (
  spec: PermissionKeyboardSpec,
): ReturnType<typeof Markup.inlineKeyboard> => {
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
): Telegraf => {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: config.handlerTimeoutMs,
  })

  const serializeError = (error: unknown) => {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    return { message: String(error) }
  }

  const logEvent = (
    level: "log" | "warn" | "error",
    event: string,
    context: Record<string, unknown> = {},
  ) => {
    const payload = {
      ts: new Date().toISOString(),
      event,
      ...context,
    }

    // One JSON object per line makes post-mortem analysis easier.
    console[level](JSON.stringify(payload))
  }
  /*
   * Telegraf wraps each update handler in a timeout. When that timeout fires,
   * it logs an error but does not cancel the async handler. To avoid dangling
   * prompts and a stuck in-flight lock, we enforce our own per-chat timeout
   * and abort the OpenCode request when it exceeds the limit.
   */
  const promptGuard = createPromptGuard(config.promptTimeoutMs)
  const pendingPermissions = new Map<string, PendingPermission>()
  const pendingQuestions = new Map<string, PendingQuestion>()
  const pendingQuestionsByChat = new Map<number, string>()

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

  const getPendingQuestionForChat = (chatId: number): PendingQuestion | null => {
    const requestId = pendingQuestionsByChat.get(chatId)
    if (!requestId) {
      return null
    }

    return pendingQuestions.get(requestId) ?? null
  }

  const truncate = (value: string, maxLength: number) => {
    if (value.length <= maxLength) {
      return value
    }

    return `${value.slice(0, maxLength)}...`
  }

  const buildQuestionPromptText = (pending: PendingQuestion) => {
    const { request, currentIndex, answers } = pending
    const questions = request.questions
    const question = questions[currentIndex]
    if (!question) {
      return "OpenCode asked a question, but the question payload was missing."
    }

    const header = (question.header ?? "").trim()
    const prompt = (question.question ?? "").trim()
    const isMultiple = Boolean(question.multiple)
    const customDisabled = question.custom === false

    const lines: string[] = [
      `OpenCode question (${currentIndex + 1}/${questions.length})`,
      ...(header ? [header] : []),
      ...(prompt ? [prompt] : []),
    ]

    const selected = new Set(
      Array.isArray(answers[currentIndex]) ? (answers[currentIndex] as Array<string>) : [],
    )

    const options = question.options ?? []
    if (options.length > 0) {
      lines.push("", "Options:")
      options.forEach((option, index) => {
        const label = truncate(String(option.label ?? "").trim(), 120)
        const description = truncate(String(option.description ?? "").trim(), 240)

        const prefix = isMultiple ? (selected.has(option.label) ? "[x]" : "[ ]") : ""
        const prefixWithSpace = prefix ? `${prefix} ` : ""
        const suffix = description ? ` - ${description}` : ""
        lines.push(`${prefixWithSpace}${index + 1}) ${label}${suffix}`)
      })
    }

    if (isMultiple) {
      lines.push(
        "",
        "This question allows selecting multiple options. Tap options to toggle, then press Next.",
      )
    }

    if (customDisabled) {
      lines.push("", "Custom answers are disabled for this question.")
    }

    lines.push(
      "",
      "If you don't choose any of the options, your next message will be treated as the answer to the question.",
    )

    // Keep some headroom under Telegram's 4096 character limit.
    return truncate(lines.join("\n"), 3800)
  }

  type InlineButton = { text: string; data: string }

  const chunk = <T>(items: T[], size: number): T[][] => {
    if (size <= 0) {
      return [items]
    }

    const rows: T[][] = []
    for (let index = 0; index < items.length; index += size) {
      rows.push(items.slice(index, index + size))
    }
    return rows
  }

  const buildQuestionKeyboardRows = (pending: PendingQuestion): InlineButton[][] => {
    const requestId = pending.request.id
    const question = pending.request.questions[pending.currentIndex]
    if (!question) {
      return [[{ text: "Cancel", data: `q:${requestId}:cancel` }]]
    }

    const optionButtons = (question.options ?? []).map((_, index) => ({
      text: String(index + 1),
      data: `q:${requestId}:opt:${index}`,
    }))
    const optionRows = chunk(optionButtons, 5)

    const isMultiple = Boolean(question.multiple)
    const isLastQuestion = pending.currentIndex >= pending.request.questions.length - 1
    const navigationRow: InlineButton[] = []

    if (isMultiple) {
      navigationRow.push({
        text: isLastQuestion ? "Submit" : "Next",
        data: `q:${requestId}:next`,
      })
    }

    navigationRow.push({ text: "Cancel", data: `q:${requestId}:cancel` })

    return optionRows.length > 0 ? [...optionRows, navigationRow] : [navigationRow]
  }

  const toTelegrafInlineKeyboardRows = (rows: InlineButton[][]) => {
    const telegrafRows = rows.map((row) =>
      row.map((button) => Markup.button.callback(button.text, button.data)),
    )
    return Markup.inlineKeyboard(telegrafRows)
  }

  const updateQuestionMessage = async (pending: PendingQuestion) => {
    const text = buildQuestionPromptText(pending)
    const replyMarkup = toTelegrafInlineKeyboardRows(buildQuestionKeyboardRows(pending))
    await bot.telegram.editMessageText(pending.chatId, pending.messageId, undefined, text, {
      reply_markup: replyMarkup.reply_markup,
    })
  }

  const clearPendingQuestion = async (
    chatId: number,
    options?: { reason?: string; reject?: boolean },
  ) => {
    const pending = getPendingQuestionForChat(chatId)
    if (!pending) {
      return
    }

    pendingQuestions.delete(pending.request.id)
    pendingQuestionsByChat.delete(chatId)

    if (options?.reject) {
      try {
        await opencode.rejectQuestion(pending.request.id, pending.directory)
      } catch (error) {
        console.error("Failed to reject question", error)
      }
    }

    if (options?.reason) {
      try {
        await bot.telegram.editMessageText(
          pending.chatId,
          pending.messageId,
          undefined,
          `${buildQuestionPromptText(pending)}\n\nStatus: ${options.reason}`,
        )
      } catch (error) {
        console.error("Failed to update question status message", error)
      }
    }
  }

  const deletePendingQuestion = (pending: PendingQuestion) => {
    pendingQuestions.delete(pending.request.id)
    const current = pendingQuestionsByChat.get(pending.chatId)
    if (current === pending.request.id) {
      pendingQuestionsByChat.delete(pending.chatId)
    }
  }

  const collectQuestionAnswers = (pending: PendingQuestion): Array<Array<string>> | null => {
    const collected: Array<Array<string>> = []
    for (const answer of pending.answers) {
      if (!answer || answer.length === 0) {
        return null
      }
      collected.push(answer)
    }
    return collected
  }

  const advanceQuestionOrSubmit = async (pending: PendingQuestion) => {
    const isLast = pending.currentIndex >= pending.request.questions.length - 1
    if (!isLast) {
      pending.currentIndex += 1
      await updateQuestionMessage(pending)
      return
    }

    const answers = collectQuestionAnswers(pending)
    if (!answers) {
      throw new Error("Missing answers for one or more questions")
    }

    await opencode.replyToQuestion(pending.request.id, answers, pending.directory)
    deletePendingQuestion(pending)

    try {
      await bot.telegram.editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        `${buildQuestionPromptText(pending)}\n\nStatus: Answer sent to OpenCode. Waiting for response...`,
      )
    } catch (error) {
      console.error("Failed to update question completion message", error)
    }
  }

  const handleQuestionTextAnswer = async (
    chatId: number,
    replyToMessageId: number | undefined,
    text: string,
  ): Promise<boolean> => {
    const pending = getPendingQuestionForChat(chatId)
    if (!pending) {
      return false
    }

    const question = pending.request.questions[pending.currentIndex]
    if (!question) {
      await sendReply(chatId, replyToMessageId, "Question not available.")
      deletePendingQuestion(pending)
      return true
    }

    if (question.custom === false) {
      await sendReply(
        chatId,
        replyToMessageId,
        "Please choose one of the options for this question.",
      )
      return true
    }

    const trimmed = text.trim()
    if (!trimmed) {
      await sendReply(chatId, replyToMessageId, "Answer cannot be empty.")
      return true
    }

    pending.answers[pending.currentIndex] = [trimmed]
    try {
      await advanceQuestionOrSubmit(pending)
    } catch (error) {
      console.error("Failed to reply to question", error)
      await sendReply(chatId, replyToMessageId, "Failed to send answer to OpenCode.")
    }

    return true
  }

  const buildBotCommands = () => {
    const commands = [
      { command: "start", description: "Confirm the bot is online" },
      {
        command: "project",
        description: "Manage project aliases (list/current/add/remove/set)",
      },
      { command: "model", description: "Show, list, or set the active model" },
      { command: "status", description: "Show project/model/session status" },
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

  opencode.startEventStream({
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
    onQuestionAsked: async ({ request, directory }) => {
      const owner = opencode.getSessionOwner(request.sessionID)
      if (!owner) {
        console.warn("Question request for unknown session", {
          sessionId: request.sessionID,
          requestId: request.id,
        })
        return
      }

      const existing = getPendingQuestionForChat(owner.chatId)
      if (existing) {
        console.warn("Question request while another question is pending", {
          chatId: owner.chatId,
          requestId: request.id,
          existingRequestId: existing.request.id,
        })
        try {
          await opencode.rejectQuestion(request.id, directory)
        } catch (error) {
          console.error("Failed to reject unexpected question", error)
        }
        return
      }

      const pending: PendingQuestion = {
        chatId: owner.chatId,
        messageId: 0,
        directory,
        request,
        currentIndex: 0,
        answers: Array.from({ length: request.questions.length }, () => null),
      }

      try {
        const replyMarkup = toTelegrafInlineKeyboardRows(buildQuestionKeyboardRows(pending))
        const message = await bot.telegram.sendMessage(owner.chatId, buildQuestionPromptText(pending), {
          reply_markup: replyMarkup.reply_markup,
        })
        pending.messageId = message.message_id
        pendingQuestions.set(request.id, pending)
        pendingQuestionsByChat.set(owner.chatId, request.id)
      } catch (error) {
        console.error("Failed to send question request", error)
      }
    },
    onError: (error: unknown) => {
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
      throw new ProjectConfigurationError("Missing project configuration.")
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
    input: PromptInput | (() => Promise<PromptInput>),
  ) => {
    const chatId = ctx.chat?.id
    const replyToMessageId = ctx.message?.message_id
    if (!chatId) {
      console.warn("Missing chat id for incoming message", { userLabel })
      void ctx.reply("Missing chat context.")
      return
    }

    const startedAt = Date.now()

    let project
    try {
      project = getProjectForChat(chatId)
    } catch (error) {
      logEvent("error", "prompt.project_missing", {
        chatId,
        replyToMessageId,
        userLabel,
        error: serializeError(error),
      })
      void ctx.reply("Missing project configuration.")
      return
    }

    logEvent("log", "prompt.start", {
      chatId,
      replyToMessageId,
      userLabel,
      projectAlias: project.alias,
      projectDir: project.path,
      promptTimeoutMs: config.promptTimeoutMs,
      hasPendingQuestion: Boolean(getPendingQuestionForChat(chatId)),
    })

    let timedOut = false
    const abortController = promptGuard.tryStart(
      chatId,
      replyToMessageId,
      ({ replyToMessageId: timeoutReplyToMessageId, sessionId }) => {
        timedOut = true
        void (async () => {
          const elapsedMs = Date.now() - startedAt
          logEvent("warn", "prompt.timeout", {
            chatId,
            replyToMessageId: timeoutReplyToMessageId,
            sessionId,
            projectAlias: project.alias,
            projectDir: project.path,
            elapsedMs,
            promptTimeoutMs: config.promptTimeoutMs,
          })

          await clearPendingQuestion(chatId, { reason: "Timed out", reject: true })

          if (!sessionId) {
            logEvent("warn", "prompt.timeout.session_not_ready", {
              chatId,
              replyToMessageId: timeoutReplyToMessageId,
              projectDir: project.path,
              elapsedMs,
            })
            await sendReply(
              chatId,
              timeoutReplyToMessageId,
              "OpenCode request timed out. Nothing to abort yet (session not ready). You can send a new message.",
            )
            return
          }

          try {
            logEvent("log", "prompt.timeout.abort_attempt", {
              chatId,
              replyToMessageId: timeoutReplyToMessageId,
              sessionId,
              projectDir: project.path,
            })
            const aborted = await opencode.abortSession(sessionId, project.path)
            logEvent("log", "prompt.timeout.abort_result", {
              chatId,
              replyToMessageId: timeoutReplyToMessageId,
              sessionId,
              projectDir: project.path,
              aborted,
            })
            if (aborted) {
              await sendReply(
                chatId,
                timeoutReplyToMessageId,
                "OpenCode request timed out. Server-side prompt aborted. You can send a new message.",
              )
              return
            }

            await sendReply(
              chatId,
              timeoutReplyToMessageId,
              "OpenCode request timed out. Tried to abort the server-side prompt, but it was not aborted. You can send a new message.",
            )
          } catch (error) {
            logEvent("error", "prompt.timeout.abort_error", {
              chatId,
              replyToMessageId: timeoutReplyToMessageId,
              sessionId,
              projectDir: project.path,
              error: serializeError(error),
            })
            await sendReply(
              chatId,
              timeoutReplyToMessageId,
              "OpenCode request timed out. Failed to abort the server-side prompt. You can send a new message.",
            )
          }
        })()
      },
    )

    if (!abortController) {
      logEvent("warn", "prompt.blocked_in_flight", {
        chatId,
        replyToMessageId,
        userLabel,
        projectAlias: project.alias,
        projectDir: project.path,
      })
      void sendReply(
        chatId,
        replyToMessageId,
        "Your previous message has not been replied to yet. This message will be ignored.",
      )
      return
    }

    void (async () => {
      try {
        const resolvedInput =
          typeof input === "function" ? await input() : input

        logEvent("log", "prompt.input", {
          chatId,
          replyToMessageId,
          projectDir: project.path,
          textLength: resolvedInput.text.length,
          fileCount: resolvedInput.files?.length ?? 0,
          fileMimes: resolvedInput.files?.map((file) => file.mime) ?? [],
        })

        if (abortController.signal.aborted) {
          logEvent("warn", "prompt.aborted_before_session", {
            chatId,
            replyToMessageId,
            projectDir: project.path,
          })
          return
        }

        const sessionId = await opencode.ensureSessionId(chatId, project.path)
        promptGuard.setSessionId(chatId, abortController, sessionId)

        logEvent("log", "prompt.session_ready", {
          chatId,
          replyToMessageId,
          sessionId,
          projectDir: project.path,
        })

        if (abortController.signal.aborted) {
          logEvent("warn", "prompt.aborted_after_session", {
            chatId,
            replyToMessageId,
            sessionId,
            projectDir: project.path,
          })
          return
        }
        const storedModel = chatModels.getModel(chatId, project.path)
        const promptOptions = storedModel
          ? { signal: abortController.signal, model: storedModel, sessionId }
          : { signal: abortController.signal, sessionId }

        logEvent("log", "prompt.send", {
          chatId,
          replyToMessageId,
          sessionId,
          projectDir: project.path,
          model: storedModel ?? null,
        })
        const result = await opencode.promptFromChat(
          chatId,
          resolvedInput,
          project.path,
          promptOptions,
        )

        logEvent("log", "prompt.success", {
          chatId,
          replyToMessageId,
          sessionId,
          projectDir: project.path,
          elapsedMs: Date.now() - startedAt,
          replyLength: result.reply.length,
          returnedModel: result.model,
        })
        if (!storedModel && result.model) {
          chatModels.setModel(chatId, project.path, result.model)
        }
        if (!timedOut) {
          await sendReply(chatId, replyToMessageId, result.reply)
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          logEvent("warn", "prompt.aborted", {
            chatId,
            replyToMessageId,
            projectDir: project.path,
            elapsedMs: Date.now() - startedAt,
            error: serializeError(error),
          })
          return
        }

        logEvent("error", "prompt.error", {
          chatId,
          replyToMessageId,
          projectDir: project.path,
          elapsedMs: Date.now() - startedAt,
          error: serializeError(error),
        })
        if (!timedOut) {
          if (error instanceof TelegramImageTooLargeError) {
            await sendReply(chatId, replyToMessageId, error.message)
            return
          }

          if (error instanceof TelegramFileDownloadTimeoutError) {
            await sendReply(
              chatId,
              replyToMessageId,
              "Failed to download file from Telegram (timed out).",
            )
            return
          }

          if (error instanceof TelegramFileDownloadError) {
            await sendReply(
              chatId,
              replyToMessageId,
              `Failed to download file from Telegram. ${error.message}`,
            )
            return
          }

          const isModelCapabilityError =
            error instanceof OpencodeModelCapabilityError ||
            error instanceof OpencodeModelModalitiesError
          const isOpencodeRequestError = error instanceof OpencodeRequestError
          const hasMatchingMessage =
            error instanceof Error &&
            (error.message.includes("does not support image input") ||
              error.message.includes("does not support PDF input") ||
              error.message.includes("does not expose modalities"))
          const message =
            isModelCapabilityError || isOpencodeRequestError || hasMatchingMessage
              ? (error as Error).message
              : "OpenCode error. Check server logs."
          await sendReply(chatId, replyToMessageId, message)
        }
      } finally {
        promptGuard.finish(chatId)

        logEvent("log", "prompt.finish", {
          chatId,
          replyToMessageId,
          projectDir: project.path,
          elapsedMs: Date.now() - startedAt,
          timedOut,
          aborted: abortController.signal.aborted,
        })
      }
    })()
  }

  bot.start(async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      await ctx.reply("Not authorized.")
      return
    }

    await ctx.reply("Bot is online. Send me a message and I'll log it here.")
  })

  bot.command("project", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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
            throw new ProjectAliasNotFoundError(
              `Project alias '${activeAlias}' not found`,
            )
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
            throw new ProjectAliasNotFoundError(
              `Project alias '${alias}' not found`,
            )
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
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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
    const { subcommand, args } = parseModelCommand(messageText)

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
        case "set": {
          const rawModel = args[0]
          if (!rawModel) {
            await ctx.reply("Usage: /model set <provider>/<model>")
            return
          }

          const [providerID, modelID] = rawModel.split("/")
          if (!providerID || !modelID) {
            await ctx.reply("Model must be in provider/model format. Use /model list.")
            return
          }

          try {
            const providers = await opencode.listModels(project.path)
            const provider = providers.find((entry) => entry.id === providerID)
            if (!provider) {
              await ctx.reply(
                `Model provider '${providerID}' not found. Use /model list.`,
              )
              return
            }

            const model = provider.models[modelID]
            if (!model) {
              await ctx.reply(
                `Model '${providerID}/${modelID}' not found. Use /model list.`,
              )
              return
            }

            chatModels.setModel(chatId, project.path, { providerID, modelID })
            await ctx.reply(`Current model set to ${providerID}/${modelID}.`)
          } catch (error) {
            console.error("Failed to set model", error)
            await ctx.reply(
              "Unexpected error when changing model. Check server logs.",
            )
          }
          return
        }
        default: {
          await ctx.reply("Usage: /model <current|list|set>")
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

  const getModelContextLimit = (
    providers: Array<{ id: string; models: Record<string, unknown> }>,
    model: { providerID: string; modelID: string },
  ): number | null => {
    const provider = providers.find((entry) => entry.id === model.providerID)
    if (!provider) {
      return null
    }

    const info = provider.models[model.modelID]
    if (!info || typeof info !== "object") {
      return null
    }

    const limit = (info as { limit?: unknown }).limit
    if (!limit || typeof limit !== "object") {
      return null
    }

    const context = (limit as { context?: unknown }).context
    if (typeof context !== "number" || !Number.isFinite(context)) {
      return null
    }

    return context
  }

  bot.command("status", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      await ctx.reply("Not authorized.")
      return
    }

    const chatId = ctx.chat?.id
    if (!chatId) {
      console.warn("Missing chat id for incoming status command")
      await ctx.reply("Missing chat context.")
      return
    }

    let project
    try {
      project = getProjectForChat(chatId)
    } catch (error) {
      console.error("Missing project for chat", { chatId, error })
      await ctx.reply("Missing project configuration.")
      return
    }

    const storedModel = chatModels.getModel(chatId, project.path)
    const sessionId = opencode.getSessionId(chatId, project.path)
    if (!sessionId) {
      const base = formatStatusReply({
        project,
        model: storedModel,
        sessionId: null,
        tokens: null,
        contextLimit: null,
      })
      await ctx.reply(`${base}\n\nNo OpenCode session yet. Send a message to start one.`)
      return
    }

    let stats: LatestAssistantStats | null = null
    try {
      stats = await opencode.getLatestAssistantStats(sessionId, project.path)
    } catch (error) {
      console.error("Failed to fetch session messages for /status", error)
    }

    const model = storedModel ?? stats?.model ?? null

    let contextLimit: number | null = null
    if (model) {
      try {
        const providers = await opencode.listModels(project.path)
        contextLimit = getModelContextLimit(
          providers as unknown as Array<{ id: string; models: Record<string, unknown> }>,
          model,
        )
      } catch (error) {
        console.error("Failed to fetch providers for /status", error)
      }
    }

    const reply = formatStatusReply({
      project,
      model,
      sessionId,
      tokens: stats?.tokens ?? null,
      contextLimit,
    })
    await ctx.reply(reply)
  })

  bot.command("reset", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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

    await clearPendingQuestion(chatId, { reason: "Aborted", reject: true })

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
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
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

    const permissionParsed = parsePermissionCallback(data)
    const questionParsed = permissionParsed ? null : parseQuestionCallback(data)
    if (!permissionParsed && !questionParsed) {
      return
    }

    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      await ctx.answerCbQuery("Not authorized.")
      return
    }

    if (permissionParsed) {
      const requestId = permissionParsed.requestId
      const permissionReply = permissionParsed.reply as PermissionReply

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
      return
    }

    const parsed = questionParsed
    if (!parsed) {
      return
    }

    const pending = pendingQuestions.get(parsed.requestId)
    if (!pending) {
      await ctx.answerCbQuery("Question request not found.")
      return
    }

    if (ctx.chat?.id !== pending.chatId) {
      await ctx.answerCbQuery("Not authorized.")
      return
    }

    if (parsed.action === "cancel") {
      try {
        await opencode.rejectQuestion(pending.request.id, pending.directory)
      } catch (error) {
        console.error("Failed to reject question", error)
      }

      deletePendingQuestion(pending)
      try {
        await bot.telegram.editMessageText(
          pending.chatId,
          pending.messageId,
          undefined,
          `${buildQuestionPromptText(pending)}\n\nStatus: Cancelled`,
        )
      } catch (error) {
        console.error("Failed to update cancelled question message", error)
      }

      await ctx.answerCbQuery("Cancelled.")
      return
    }

    const question = pending.request.questions[pending.currentIndex]
    if (!question) {
      await ctx.answerCbQuery("Question not available.")
      return
    }

    const options = question.options ?? []
    const optionLabels = new Set(options.map((option) => option.label))

    if (parsed.action === "option") {
      if (parsed.optionIndex >= options.length) {
        await ctx.answerCbQuery("Invalid option.")
        return
      }

      const selectedOption = options[parsed.optionIndex]
      if (!selectedOption) {
        await ctx.answerCbQuery("Invalid option.")
        return
      }

      const selectedLabel = selectedOption.label
      if (question.multiple) {
        const current = pending.answers[pending.currentIndex]
        const base = Array.isArray(current)
          ? current.filter((value) => optionLabels.has(value))
          : []

        const next = base.includes(selectedLabel)
          ? base.filter((value) => value !== selectedLabel)
          : [...base, selectedLabel]

        pending.answers[pending.currentIndex] = next

        try {
          await updateQuestionMessage(pending)
          await ctx.answerCbQuery("Updated.")
        } catch (error) {
          console.error("Failed to update question message", error)
          await ctx.answerCbQuery("Failed to update.")
        }
        return
      }

      pending.answers[pending.currentIndex] = [selectedLabel]
      try {
        await advanceQuestionOrSubmit(pending)
        await ctx.answerCbQuery("Selected.")
      } catch (error) {
        console.error("Failed to submit question answer", error)
        await ctx.answerCbQuery("Failed to send answer.")
      }
      return
    }

    if (parsed.action === "next") {
      if (!question.multiple) {
        await ctx.answerCbQuery("Select an option.")
        return
      }

      const current = pending.answers[pending.currentIndex]
      const hasAnswer = Array.isArray(current) && current.length > 0
      if (!hasAnswer) {
        await ctx.answerCbQuery(
          question.custom === false
            ? "Select at least one option."
            : "Select at least one option or type an answer.",
        )
        return
      }

      try {
        await advanceQuestionOrSubmit(pending)
        await ctx.answerCbQuery("Sent.")
      } catch (error) {
        console.error("Failed to submit question answer", error)
        await ctx.answerCbQuery("Failed to send answer.")
      }
    }
  })

  bot.on("text", async (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      void ctx.reply("Not authorized.")
      return
    }

    if (ctx.message && isCommandMessage(ctx.message)) {
      return
    }

    const text = ctx.message.text
    const userLabel = formatUserLabel(ctx.from)

    console.log(`[telegram] ${userLabel}: ${text}`)

    const chatId = ctx.chat?.id
    const replyToMessageId = ctx.message?.message_id
    if (chatId) {
      const handled = await handleQuestionTextAnswer(chatId, replyToMessageId, text)
      if (handled) {
        return
      }
    }

    runPrompt(ctx, userLabel, { text })
  })

  bot.on("photo", (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      void ctx.reply("Not authorized.")
      return
    }

    if (!ctx.message || !("photo" in ctx.message)) {
      return
    }

    if (isCommandMessage(ctx.message)) {
      return
    }

    const chatId = ctx.chat?.id
    if (chatId && getPendingQuestionForChat(chatId)) {
      void ctx.reply(
        "OpenCode is waiting for you to answer a question. Please reply with text or use the buttons.",
      )
      return
    }

    const userLabel = formatUserLabel(ctx.from)
    const telegram = ctx.telegram
    const photos = ctx.message.photo
    const caption = ctx.message.caption ?? ""
    const largest = pickLargestPhoto(photos)

    runPrompt(ctx, userLabel, async () => {
      const attachment = await downloadTelegramImageAsAttachment(
        telegram,
        largest.file_id,
        {
          mime: "image/jpeg",
          filename: "photo.jpg",
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          timeoutMs: config.telegramDownloadTimeoutMs ?? 30_000,
          ...(largest.file_size != null ? { declaredSize: largest.file_size } : {}),
        },
      )

      const text = caption.trim()
        ? caption
        : "Please analyze the attached image."

      return {
        text,
        files: [
          {
            mime: attachment.mime,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            dataUrl: attachment.dataUrl,
          },
        ],
      }
    })
  })

  bot.on("document", (ctx) => {
    if (!isAuthorized(ctx.from, config.allowedUserIds)) {
      void ctx.reply("Not authorized.")
      return
    }

    if (!ctx.message || !("document" in ctx.message)) {
      return
    }

    if (isCommandMessage(ctx.message)) {
      return
    }

    const chatId = ctx.chat?.id
    if (chatId && getPendingQuestionForChat(chatId)) {
      void ctx.reply(
        "OpenCode is waiting for you to answer a question. Please reply with text or use the buttons.",
      )
      return
    }

    const userLabel = formatUserLabel(ctx.from)
    const telegram = ctx.telegram
    const document = ctx.message.document
    const caption = ctx.message.caption ?? ""
    const mime = document.mime_type ?? "application/octet-stream"
    const filename = document.file_name

    const isImage = isImageDocument(document)
    const isPdf = isPdfDocument(document)
    if (!isImage && !isPdf) {
      void ctx.reply("Unsupported document type. Please send an image or PDF.")
      return
    }

    // Telegram's `Document.mime_type` is optional and "as defined by the sender".
    // In practice, PDFs sometimes arrive with `mime_type` missing even when the
    // filename ends with `.pdf`. OpenCode relies on `mime=application/pdf` to
    // treat the attachment as a PDF, so we infer it from the filename when needed.
    const inferredMime = isPdf ? "application/pdf" : mime

    runPrompt(ctx, userLabel, async () => {
      const attachment = await downloadTelegramFileAsAttachment(telegram, document.file_id, {
        mime: inferredMime,
        ...(filename ? { filename } : {}),
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
        timeoutMs: config.telegramDownloadTimeoutMs ?? 30_000,
        ...(document.file_size != null ? { declaredSize: document.file_size } : {}),
      })

      const text = caption.trim()
        ? caption
        : isPdf
          ? "Please analyze the attached PDF."
          : "Please analyze the attached image."

      return {
        text,
        files: [
          {
            mime: attachment.mime,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
            dataUrl: attachment.dataUrl,
          },
        ],
      }
    })
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
