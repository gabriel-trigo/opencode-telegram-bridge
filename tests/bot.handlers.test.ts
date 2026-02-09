import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => {
  return {
    exec: vi.fn(),
  }
})

type TelegrafMockState = {
  lastBot: {
    telegram: {
      sendMessage: ReturnType<typeof vi.fn>
      editMessageText: ReturnType<typeof vi.fn>
      setMyCommands: ReturnType<typeof vi.fn>
    }
    dispatchStart: (ctx: any) => Promise<void>
    dispatchCommand: (command: string, ctx: any) => Promise<void>
    dispatchOn: (event: string, ctx: any) => Promise<void>
  } | null
}

vi.mock("telegraf", () => {
  const state: TelegrafMockState = { lastBot: null }
  ;(globalThis as any).__telegrafMockState = state

  const Markup = {
    button: {
      callback: (text: string, data: string) => ({
        text,
        callback_data: data,
      }),
    },
    inlineKeyboard: (rows: Array<Array<{ text: string; callback_data: string }>>) => ({
      reply_markup: {
        inline_keyboard: rows,
      },
    }),
  }

  class Telegraf {
    public telegram = {
      sendMessage: vi.fn(async () => ({ message_id: 123 })),
      editMessageText: vi.fn(async () => undefined),
      setMyCommands: vi.fn(async () => undefined),
      getFileLink: vi.fn(async (_fileId: string) => new URL("https://example.com/file")),
    }

    private startHandler: ((ctx: any) => any) | null = null
    private commandHandlers = new Map<string, (ctx: any) => any>()
    private onHandlers = new Map<string, (ctx: any) => any>()

    constructor(_token: string, _options?: unknown) {
      state.lastBot = {
        telegram: this.telegram,
        dispatchStart: async (ctx: any) => {
          await this.startHandler?.(ctx)
        },
        dispatchCommand: async (command: string, ctx: any) => {
          const handler = this.commandHandlers.get(command)
          if (!handler) {
            throw new Error(`No handler registered for /${command}`)
          }
          await handler(ctx)
        },
        dispatchOn: async (event: string, ctx: any) => {
          const handler = this.onHandlers.get(event)
          if (!handler) {
            throw new Error(`No handler registered for on('${event}')`)
          }
          await handler(ctx)
        },
      }
    }

    start(handler: (ctx: any) => any) {
      this.startHandler = handler
      return this
    }

    command(command: string, handler: (ctx: any) => any) {
      this.commandHandlers.set(command, handler)
      return this
    }

    on(event: string, handler: (ctx: any) => any) {
      this.onHandlers.set(event, handler)
      return this
    }

    catch(_handler: (err: unknown, ctx: any) => any) {
      return this
    }

    launch() {
      return this
    }

    stop(_reason?: string) {
      return this
    }
  }

  return { Telegraf, Markup }
})

const createTextCtx = (options: {
  userId: number
  chatId?: number
  text: string
  messageId?: number
  entities?: Array<{ type: string; offset: number }>
}) => {
  const messageId = options.messageId ?? 100
  return {
    from: { id: options.userId, username: "user" },
    chat: options.chatId == null ? undefined : { id: options.chatId },
    message: {
      text: options.text,
      message_id: messageId,
      entities: options.entities,
    },
    reply: vi.fn(async () => undefined),
  }
}

const createCallbackCtx = (options: {
  userId: number
  chatId: number
  data: string
}) => {
  return {
    from: { id: options.userId, username: "user" },
    chat: { id: options.chatId },
    callbackQuery: { data: options.data },
    answerCbQuery: vi.fn(async () => undefined),
  }
}

const createPhotoCtx = (options: {
  userId: number
  chatId: number
  messageId?: number
  caption?: string
  fileId?: string
  fileSize?: number
}) => {
  const messageId = options.messageId ?? 100
  return {
    from: { id: options.userId, username: "user" },
    chat: { id: options.chatId },
    message: {
      message_id: messageId,
      caption: options.caption,
      photo: [
        {
          file_id: options.fileId ?? "file-1",
          width: 100,
          height: 100,
          ...(options.fileSize != null ? { file_size: options.fileSize } : {}),
        },
      ],
    },
    reply: vi.fn(async () => undefined),
    telegram: (globalThis as any).__telegrafMockState.lastBot?.telegram,
  }
}

const createDocumentCtx = (options: {
  userId: number
  chatId: number
  messageId?: number
  caption?: string
  fileId?: string
  fileName?: string
  mimeType?: string
  fileSize?: number
}) => {
  const messageId = options.messageId ?? 100
  return {
    from: { id: options.userId, username: "user" },
    chat: { id: options.chatId },
    message: {
      message_id: messageId,
      caption: options.caption,
      document: {
        file_id: options.fileId ?? "file-1",
        file_name: options.fileName,
        mime_type: options.mimeType,
        ...(options.fileSize != null ? { file_size: options.fileSize } : {}),
      },
    },
    reply: vi.fn(async () => undefined),
    telegram: (globalThis as any).__telegrafMockState.lastBot?.telegram,
  }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe("bot handler behavior", () => {
  beforeEach(() => {
    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    if (state) {
      state.lastBot = null
    }
    vi.useRealTimers()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "log").mockImplementation(() => undefined)
  })

  it("sends prompts to OpenCode and replies via bot.telegram.sendMessage", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: (alias: string) =>
        alias === "home" ? { alias: "home", path: "/home/user" } : null,
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }

    const chatProjects = {
      getActiveAlias: () => null,
      setActiveAlias: vi.fn(),
      clearActiveAlias: vi.fn(),
    }

    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot
    expect(bot).not.toBeNull()

    const ctx = createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 200 })
    await bot!.dispatchOn("text", ctx)
    await flushMicrotasks()

    expect(opencode.promptFromChat).toHaveBeenCalledTimes(1)
    expect(bot!.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "hi",
      expect.objectContaining({ reply_parameters: { message_id: 200 } }),
    )
  })

  it("blocks concurrent prompts per chat", async () => {
    let resolvePrompt!: (value: any) => void
    const pending = new Promise((resolve) => {
      resolvePrompt = resolve
    })

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(() => pending),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 10_000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 1 }),
    )
    await flushMicrotasks()
    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "second", messageId: 2 }),
    )
    await flushMicrotasks()

    expect(opencode.promptFromChat).toHaveBeenCalledTimes(1)
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "Your previous message has not been replied to yet. This message will be ignored.",
      expect.objectContaining({ reply_parameters: { message_id: 2 } }),
    )

    resolvePrompt({ reply: "done", model: null })
    await flushMicrotasks()
  })

  it("/abort aborts the in-flight prompt and allows another prompt", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      abortSession: vi.fn(async () => true),
      promptFromChat: vi.fn(
        async (_chatId: number, input: any, _dir: string, options?: any) => {
          if (input?.text === "second") {
            return { reply: "ok", model: null }
          }

          const signal = options?.signal as AbortSignal | undefined
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted") as Error & { name: string }
                error.name = "AbortError"
                reject(error)
              },
              { once: true },
            )
          }) as any
        },
      ),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 10_000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 50 }),
    )
    await flushMicrotasks()

    const abortCtx = createTextCtx({ userId: 1, chatId: 10, text: "/abort" })
    await bot.dispatchCommand("abort", abortCtx)
    await flushMicrotasks()

    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "Aborting response to this prompt...",
      expect.objectContaining({ reply_parameters: { message_id: 50 } }),
    )
    expect(opencode.abortSession).toHaveBeenCalledWith("session-1", "/home/user")

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "second", messageId: 51 }),
    )
    await flushMicrotasks()

    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "ok",
      expect.objectContaining({ reply_parameters: { message_id: 51 } }),
    )
  })

  it("times out a prompt, aborts it, and allows a new prompt", async () => {
    vi.useFakeTimers()

    let capturedSignal: AbortSignal | undefined
    let resolvePrompt!: (value: any) => void
    const firstPrompt = new Promise((resolve) => {
      resolvePrompt = resolve
    })

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async (_chatId: number, _text: string, _dir: string, options?: any) => {
        capturedSignal = options?.signal
        return firstPrompt as any
      }),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 10 }),
    )
    await flushMicrotasks()

    vi.advanceTimersByTime(1000)
    await flushMicrotasks()

    expect(capturedSignal?.aborted).toBe(true)
    expect(opencode.abortSession).toHaveBeenCalledWith("session-1", "/home/user")
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "OpenCode request timed out. Server-side prompt aborted. You can send a new message.",
      expect.objectContaining({ reply_parameters: { message_id: 10 } }),
    )

    resolvePrompt({ reply: "late", model: null })
    await flushMicrotasks()

    opencode.promptFromChat.mockResolvedValueOnce({ reply: "second", model: null })
    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "second", messageId: 11 }),
    )
    await flushMicrotasks()

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "second",
      expect.objectContaining({ reply_parameters: { message_id: 11 } }),
    )
  })

  it("timeout message reports session not ready when ensureSessionId is still pending", async () => {
    vi.useFakeTimers()

    let resolveSessionId!: (value: string) => void
    const pendingSessionId = new Promise<string>((resolve) => {
      resolveSessionId = resolve
    })

    const opencode = {
      ensureSessionId: vi.fn(async () => pendingSessionId),
      promptFromChat: vi.fn(async () => ({ reply: "should-not-run", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 10 }),
    )
    await flushMicrotasks()

    vi.advanceTimersByTime(1000)
    await flushMicrotasks()

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "OpenCode request timed out. Nothing to abort yet (session not ready). You can send a new message.",
      expect.objectContaining({ reply_parameters: { message_id: 10 } }),
    )
    expect(opencode.abortSession).not.toHaveBeenCalled()
    expect(opencode.promptFromChat).not.toHaveBeenCalled()

    resolveSessionId("session-1")
    await flushMicrotasks()

    // Still should not proceed to send the prompt after timing out.
    expect(opencode.promptFromChat).not.toHaveBeenCalled()
  })

  it("timeout message reports when abort was not successful", async () => {
    vi.useFakeTimers()

    let capturedSignal: AbortSignal | undefined
    const firstPrompt = new Promise((_resolve) => {
      // never resolves
    })

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async (_chatId: number, _text: string, _dir: string, options?: any) => {
        capturedSignal = options?.signal
        return firstPrompt as any
      }),
      abortSession: vi.fn(async () => false),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 10 }),
    )
    await flushMicrotasks()

    vi.advanceTimersByTime(1000)
    await flushMicrotasks()

    expect(capturedSignal?.aborted).toBe(true)
    expect(opencode.abortSession).toHaveBeenCalledWith("session-1", "/home/user")
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "OpenCode request timed out. Tried to abort the server-side prompt, but it was not aborted. You can send a new message.",
      expect.objectContaining({ reply_parameters: { message_id: 10 } }),
    )
  })

  it("timeout message reports when abort throws", async () => {
    vi.useFakeTimers()

    const firstPrompt = new Promise((_resolve) => {
      // never resolves
    })

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => firstPrompt as any),
      abortSession: vi.fn(async () => {
        throw new Error("abort failed")
      }),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 10 }),
    )
    await flushMicrotasks()

    vi.advanceTimersByTime(1000)
    await flushMicrotasks()

    expect(opencode.abortSession).toHaveBeenCalledWith("session-1", "/home/user")
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "OpenCode request timed out. Failed to abort the server-side prompt. You can send a new message.",
      expect.objectContaining({ reply_parameters: { message_id: 10 } }),
    )
  })

  it("permission flow: event -> inline buttons -> callback -> reply + edit", async () => {
    const permissionHandlers: { onPermissionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        permissionHandlers.onPermissionAsked = handlers.onPermissionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await permissionHandlers.onPermissionAsked({
      request: {
        id: "perm-1",
        sessionID: "session-1",
        permission: "fs.write",
        patterns: ["src/**"],
        always: ["/home/user"],
      },
      directory: "/home/user",
    })

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      expect.stringContaining("OpenCode permission request"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Approve once", callback_data: "perm:perm-1:once" },
              {
                text: "Approve always",
                callback_data: "perm:perm-1:always",
              },
              { text: "Reject", callback_data: "perm:perm-1:reject" },
            ],
          ],
        },
      }),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "perm:perm-1:once" }),
    )

    expect(opencode.replyToPermission).toHaveBeenCalledWith(
      "perm-1",
      "once",
      "/home/user",
    )
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("Decision: Approved (once)"),
    )
  })

  it("question flow: event -> inline buttons -> callback -> reply + edit", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick",
            question: "Choose one option",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      expect.stringContaining("OpenCode question"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              { text: "1", callback_data: "q:q-1:opt:0" },
              { text: "2", callback_data: "q:q-1:opt:1" },
            ],
            [{ text: "Cancel", callback_data: "q:q-1:cancel" }],
          ],
        },
      }),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-1:opt:0" }),
    )

    expect(opencode.replyToQuestion).toHaveBeenCalledWith(
      "q-1",
      [["A"]],
      "/home/user",
    )
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("Status: Answer sent"),
    )
  })

  it("question flow: multi-select toggles options and submits on Submit", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-multi",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick",
            question: "Choose one or more",
            multiple: true,
            options: [
              { label: "Typecheck", description: "Run tsc" },
              { label: "Tests", description: "Run vitest" },
              { label: "Build", description: "Run build" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      expect.stringContaining("OpenCode question"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              { text: "1", callback_data: "q:q-multi:opt:0" },
              { text: "2", callback_data: "q:q-multi:opt:1" },
              { text: "3", callback_data: "q:q-multi:opt:2" },
            ],
            [
              { text: "Submit", callback_data: "q:q-multi:next" },
              { text: "Cancel", callback_data: "q:q-multi:cancel" },
            ],
          ],
        },
      }),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-multi:opt:0" }),
    )

    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("[x] 1) Typecheck"),
      expect.anything(),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-multi:opt:2" }),
    )

    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("[x] 3) Build"),
      expect.anything(),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-multi:next" }),
    )

    expect(opencode.replyToQuestion).toHaveBeenCalledWith(
      "q-multi",
      [["Typecheck", "Build"]],
      "/home/user",
    )
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("Status: Answer sent"),
    )
  })

  it("question flow: multiple questions advances and submits once", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-two",
        sessionID: "session-1",
        questions: [
          {
            header: "Step 1",
            question: "Choose A or B",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
          {
            header: "Step 2",
            question: "Choose X or Y",
            options: [
              { label: "X", description: "Option X" },
              { label: "Y", description: "Option Y" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-two:opt:1" }),
    )

    expect(opencode.replyToQuestion).not.toHaveBeenCalled()
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("OpenCode question (2/2)"),
      expect.anything(),
    )

    await bot.dispatchOn(
      "callback_query",
      createCallbackCtx({ userId: 1, chatId: 10, data: "q:q-two:opt:0" }),
    )

    expect(opencode.replyToQuestion).toHaveBeenCalledWith(
      "q-two",
      [["B"], ["X"]],
      "/home/user",
    )
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("Status: Answer sent"),
    )
  })

  it("question flow: cancel rejects the question and clears pending state", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "ok", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-cancel",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick",
            question: "Choose one option",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    const cancelCtx = createCallbackCtx({
      userId: 1,
      chatId: 10,
      data: "q:q-cancel:cancel",
    })
    await bot.dispatchOn("callback_query", cancelCtx)

    expect(opencode.rejectQuestion).toHaveBeenCalledWith("q-cancel", "/home/user")
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      10,
      123,
      undefined,
      expect.stringContaining("Status: Cancelled"),
    )
    expect(cancelCtx.answerCbQuery).toHaveBeenCalledWith("Cancelled.")

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 200 }),
    )
    await flushMicrotasks()

    expect(opencode.promptFromChat).toHaveBeenCalledTimes(1)
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "ok",
      expect.objectContaining({ reply_parameters: { message_id: 200 } }),
    )
  })

  it("question flow: custom=false does not accept typed answers", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "ok", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-custom-off",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick",
            question: "Choose one option",
            custom: false,
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "my answer", messageId: 300 }),
    )
    await flushMicrotasks()

    expect(opencode.replyToQuestion).not.toHaveBeenCalled()
    expect(opencode.promptFromChat).not.toHaveBeenCalled()
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "Please choose one of the options for this question.",
      expect.objectContaining({ reply_parameters: { message_id: 300 } }),
    )
  })

  it("question flow: multi-select Submit with nothing selected does not reply to OpenCode", async () => {
    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-empty",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick",
            question: "Choose one or more",
            multiple: true,
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
        ],
      },
      directory: "/home/user",
    })

    const submitCtx = createCallbackCtx({
      userId: 1,
      chatId: 10,
      data: "q:q-empty:next",
    })
    await bot.dispatchOn("callback_query", submitCtx)

    expect(opencode.replyToQuestion).not.toHaveBeenCalled()
    expect(submitCtx.answerCbQuery).toHaveBeenCalledWith(
      "Select at least one option or type an answer.",
    )
  })

  it("treats next message as question answer while prompt is in-flight", async () => {
    let resolvePrompt!: (value: any) => void
    const pendingPrompt = new Promise((resolve) => {
      resolvePrompt = resolve
    })

    const eventHandlers: { onQuestionAsked?: any } = {}

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(() => pendingPrompt as any),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      replyToQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        eventHandlers.onQuestionAsked = handlers.onQuestionAsked
        return { stop: () => undefined }
      }),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 10_000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "first", messageId: 1 }),
    )
    await flushMicrotasks()

    await eventHandlers.onQuestionAsked({
      request: {
        id: "q-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Answer",
            question: "Type anything",
            options: [{ label: "A", description: "Option A" }],
          },
        ],
      },
      directory: "/home/user",
    })

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "my answer", messageId: 2 }),
    )
    await flushMicrotasks()

    expect(opencode.promptFromChat).toHaveBeenCalledTimes(1)
    expect(opencode.replyToQuestion).toHaveBeenCalledWith(
      "q-1",
      [["my answer"]],
      "/home/user",
    )
    expect(bot.telegram.sendMessage).not.toHaveBeenCalledWith(
      10,
      "Your previous message has not been replied to yet. This message will be ignored.",
      expect.objectContaining({ reply_parameters: { message_id: 2 } }),
    )

    resolvePrompt({ reply: "done", model: null })
    await flushMicrotasks()
  })

  it("/start enforces allowlist", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const unauthorized = createTextCtx({ userId: 2, chatId: 10, text: "/start" })
    await bot.dispatchStart(unauthorized)
    expect(unauthorized.reply).toHaveBeenCalledWith("Not authorized.")

    const authorized = createTextCtx({ userId: 1, chatId: 10, text: "/start" })
    await bot.dispatchStart(authorized)
    expect(authorized.reply).toHaveBeenCalledWith(
      "Bot is online. Send me a message and I'll log it here.",
    )
  })

  it("/project covers list/current/add/remove/set + usage + errors", async () => {
    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [
        { alias: "home", path: "/home/user" },
        { alias: "demo", path: "/repo/demo" },
      ],
      getProject: (alias: string) => {
        if (alias === "home") return { alias: "home", path: "/home/user" }
        if (alias === "demo") return { alias: "demo", path: "/repo/demo" }
        return null
      },
      addProject: vi.fn((alias: string, projectPath: string) => ({
        alias,
        path: projectPath,
      })),
      removeProject: vi.fn(),
    }

    const chatProjects = {
      getActiveAlias: vi.fn(() => "demo"),
      setActiveAlias: vi.fn(),
      clearActiveAlias: vi.fn(),
    }

    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const unauthorized = createTextCtx({ userId: 2, chatId: 10, text: "/project" })
    await bot.dispatchCommand("project", unauthorized)
    expect(unauthorized.reply).toHaveBeenCalledWith("Not authorized.")

    const listCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project list" })
    await bot.dispatchCommand("project", listCtx)
    expect(listCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Projects (active marked with *):"),
    )

    const currentCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project current" })
    await bot.dispatchCommand("project", currentCtx)
    expect(currentCtx.reply).toHaveBeenCalledWith("demo: /repo/demo")

    const addUsageCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project add" })
    await bot.dispatchCommand("project", addUsageCtx)
    expect(addUsageCtx.reply).toHaveBeenCalledWith("Usage: /project add <alias> <path>")

    const addCtx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/project add new /repo/new",
    })
    await bot.dispatchCommand("project", addCtx)
    expect(projects.addProject).toHaveBeenCalledWith("new", "/repo/new")
    expect(addCtx.reply).toHaveBeenCalledWith("Added new: /repo/new")

    const removeUsageCtx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/project remove",
    })
    await bot.dispatchCommand("project", removeUsageCtx)
    expect(removeUsageCtx.reply).toHaveBeenCalledWith("Usage: /project remove <alias>")

    const removeCtx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/project remove demo",
    })
    await bot.dispatchCommand("project", removeCtx)
    expect(projects.removeProject).toHaveBeenCalledWith("demo")
    expect(chatProjects.setActiveAlias).toHaveBeenCalledWith(10, "home")
    expect(removeCtx.reply).toHaveBeenCalledWith("Removed demo")

    const setUsageCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project set" })
    await bot.dispatchCommand("project", setUsageCtx)
    expect(setUsageCtx.reply).toHaveBeenCalledWith("Usage: /project set <alias>")

    const setCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project set home" })
    await bot.dispatchCommand("project", setCtx)
    expect(chatProjects.setActiveAlias).toHaveBeenCalledWith(10, "home")
    expect(setCtx.reply).toHaveBeenCalledWith("Active project: home")

    const unknownCtx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/project wat",
    })
    await bot.dispatchCommand("project", unknownCtx)
    expect(unknownCtx.reply).toHaveBeenCalledWith(
      "Usage: /project <list|current|add|remove|set> ...",
    )

    const missingChatCtx = createTextCtx({ userId: 1, text: "/project list" })
    await bot.dispatchCommand("project", missingChatCtx)
    expect(missingChatCtx.reply).toHaveBeenCalledWith("Missing chat context.")

    const failingProjects = {
      ...projects,
      removeProject: vi.fn(() => {
        throw new Error("boom")
      }),
    }
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      failingProjects as any,
      chatProjects as any,
      chatModels as any,
    )
    const state2 = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot2 = state2.lastBot!
    const errorCtx = createTextCtx({ userId: 1, chatId: 10, text: "/project remove demo" })
    await bot2.dispatchCommand("project", errorCtx)
    expect(errorCtx.reply).toHaveBeenCalledWith("boom")
  })

  it("/model covers current/list + error branches", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => [
        { id: "p", models: { m: { name: "M" } } },
      ]),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: vi.fn((): { providerID: string; modelID: string } | null => null),
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const unauthorized = createTextCtx({ userId: 2, chatId: 10, text: "/model" })
    await bot.dispatchCommand("model", unauthorized)
    expect(unauthorized.reply).toHaveBeenCalledWith("Not authorized.")

    const currentNoModel = createTextCtx({ userId: 1, chatId: 10, text: "/model" })
    await bot.dispatchCommand("model", currentNoModel)
    expect(currentNoModel.reply).toHaveBeenCalledWith(
      expect.stringContaining("Model unavailable"),
    )

    chatModels.getModel.mockReturnValueOnce({ providerID: "p", modelID: "m" })
    const currentModel = createTextCtx({ userId: 1, chatId: 10, text: "/model current" })
    await bot.dispatchCommand("model", currentModel)
    expect(currentModel.reply).toHaveBeenCalledWith("Current model: p/m")

    const listCtx = createTextCtx({ userId: 1, chatId: 10, text: "/model list", messageId: 55 })
    await bot.dispatchCommand("model", listCtx)
    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      expect.stringContaining("Available models:"),
      expect.objectContaining({ reply_parameters: { message_id: 55 } }),
    )

    const usageCtx = createTextCtx({ userId: 1, chatId: 10, text: "/model wat" })
    await bot.dispatchCommand("model", usageCtx)
    expect(usageCtx.reply).toHaveBeenCalledWith("Usage: /model <current|list|set>")

    opencode.listModels.mockRejectedValueOnce(new Error("boom"))
    const errorCtx = createTextCtx({ userId: 1, chatId: 10, text: "/model list" })
    await bot.dispatchCommand("model", errorCtx)
    expect(errorCtx.reply).toHaveBeenCalledWith("boom")
  })

  it("/model set validates input, stores model, and overrides prompts", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => [
        {
          id: "openai",
          models: {
            "gpt-5.2-codex": { name: "GPT-5.2 Codex" },
            "gpt-5.2": { name: "GPT-5.2" },
          },
        },
      ]),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    let storedModel: { providerID: string; modelID: string } | null = null
    const chatModels = {
      getModel: vi.fn(() => storedModel),
      setModel: vi.fn((_chatId: number, _projectDir: string, model: any) => {
        storedModel = model
      }),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const missingArg = createTextCtx({ userId: 1, chatId: 10, text: "/model set" })
    await bot.dispatchCommand("model", missingArg)
    expect(missingArg.reply).toHaveBeenCalledWith("Usage: /model set <provider>/<model>")

    const invalidFormat = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/model set gpt-5.2-codex",
    })
    await bot.dispatchCommand("model", invalidFormat)
    expect(invalidFormat.reply).toHaveBeenCalledWith(
      "Model must be in provider/model format. Use /model list.",
    )

    const missingProvider = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/model set missing/gpt",
    })
    await bot.dispatchCommand("model", missingProvider)
    expect(missingProvider.reply).toHaveBeenCalledWith(
      "Model provider 'missing' not found. Use /model list.",
    )

    const missingModel = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/model set openai/missing",
    })
    await bot.dispatchCommand("model", missingModel)
    expect(missingModel.reply).toHaveBeenCalledWith(
      "Model 'openai/missing' not found. Use /model list.",
    )

    const success = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/model set openai/gpt-5.2-codex",
    })
    await bot.dispatchCommand("model", success)
    expect(success.reply).toHaveBeenCalledWith(
      "Current model set to openai/gpt-5.2-codex.",
    )
    expect(storedModel).toEqual({ providerID: "openai", modelID: "gpt-5.2-codex" })

    const promptCtx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "hello",
      messageId: 99,
    })
    await bot.dispatchOn("text", promptCtx)
    await flushMicrotasks()

    expect(opencode.promptFromChat).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ text: "hello" }),
      "/home/user",
      expect.objectContaining({
        model: { providerID: "openai", modelID: "gpt-5.2-codex" },
      }),
    )
  })

  it("/model set reports unexpected errors", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => {
        throw new Error("boom")
      }),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: vi.fn(() => null),
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const ctx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/model set openai/gpt-5.2",
    })
    await bot.dispatchCommand("model", ctx)
    expect(ctx.reply).toHaveBeenCalledWith(
      "Unexpected error when changing model. Check server logs.",
    )
  })

  it("/status reports a clear message when no session exists", async () => {
    const opencode = {
      getSessionId: vi.fn(() => undefined),
      getLatestAssistantStats: vi.fn(async () => ({ model: null, tokens: null })),
      listModels: vi.fn(async () => []),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
      getSessionOwner: vi.fn(() => null),
      resetAllSessions: vi.fn(() => undefined),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: vi.fn(() => null),
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const ctx = createTextCtx({ userId: 1, chatId: 10, text: "/status" })
    await bot.dispatchCommand("status", ctx)

    expect(opencode.getLatestAssistantStats).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("No OpenCode session yet"),
    )
  })

  it("/status shows context usage based on last assistant message", async () => {
    const opencode = {
      getSessionId: vi.fn(() => "session-1"),
      getLatestAssistantStats: vi.fn(async () => ({
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        tokens: {
          input: 1000,
          output: 200,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      })),
      listModels: vi.fn(async () => [
        {
          id: "openai",
          models: {
            "gpt-5.3-codex": {
              limit: { context: 8000 },
            },
          },
        },
      ]),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
      getSessionOwner: vi.fn(() => null),
      resetAllSessions: vi.fn(() => undefined),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: vi.fn(() => null),
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const ctx = createTextCtx({ userId: 1, chatId: 10, text: "/status" })
    await bot.dispatchCommand("status", ctx)

    expect(opencode.getLatestAssistantStats).toHaveBeenCalledWith(
      "session-1",
      "/home/user",
    )
    expect(opencode.listModels).toHaveBeenCalledWith("/home/user")
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Context (input): 1000 / 8000 (12.5%)"),
    )
  })

  it("/reset covers didReset and no-session branches", async () => {
    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => true),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const didReset = createTextCtx({ userId: 1, chatId: 10, text: "/reset" })
    await bot.dispatchCommand("reset", didReset)
    expect(chatModels.clearModel).toHaveBeenCalledWith(10, "/home/user")
    expect(didReset.reply).toHaveBeenCalledWith("Session reset for home.")

    opencode.resetSession.mockReturnValueOnce(false)
    const noSession = createTextCtx({ userId: 1, chatId: 10, text: "/reset" })
    await bot.dispatchCommand("reset", noSession)
    expect(noSession.reply).toHaveBeenCalledWith(
      "No active session to reset for home.",
    )
  })

  it("/reboot and /restart cover configured/unconfigured branches", async () => {
    const childProcess = await import("node:child_process")
    const exec = childProcess.exec as unknown as ReturnType<typeof vi.fn>

    exec.mockImplementationOnce(
      (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        cb(null, "ok\n", "")
      },
    )
    exec.mockImplementationOnce(
      (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        cb(null, "", "")
      },
    )

    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )
    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const rebootUnconfigured = createTextCtx({ userId: 1, chatId: 10, text: "/reboot" })
    await bot.dispatchCommand("reboot", rebootUnconfigured)
    expect(rebootUnconfigured.reply).toHaveBeenCalledWith(
      expect.stringContaining("Restart command not configured"),
    )

    const restartUnconfigured = createTextCtx({ userId: 1, chatId: 10, text: "/restart" })
    await bot.dispatchCommand("restart", restartUnconfigured)
    expect(restartUnconfigured.reply).toHaveBeenCalledWith(
      expect.stringContaining("Restart command not configured"),
    )

    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
        opencodeRestart: { command: "echo reboot", timeoutMs: 1000 },
        bridgeRestart: { command: "echo restart", timeoutMs: 1000 },
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )
    const state2 = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot2 = state2.lastBot!

    const rebootConfigured = createTextCtx({ userId: 1, chatId: 10, text: "/reboot" })
    await bot2.dispatchCommand("reboot", rebootConfigured)
    expect(opencode.resetAllSessions).toHaveBeenCalledTimes(1)
    expect(chatModels.clearAll).toHaveBeenCalledTimes(1)
    expect(rebootConfigured.reply).toHaveBeenCalledWith(
      expect.stringContaining("OpenCode restart triggered"),
    )

    const restartConfigured = createTextCtx({ userId: 1, chatId: 10, text: "/restart" })
    await bot2.dispatchCommand("restart", restartConfigured)
    expect(restartConfigured.reply).toHaveBeenCalledWith(
      "Restarting opencode-telegram-bridge...",
    )
  })

  it("text handler rejects unauthorized users", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!
    const ctx = createTextCtx({ userId: 2, chatId: 10, text: "hello" })
    await bot.dispatchOn("text", ctx)

    expect(ctx.reply).toHaveBeenCalledWith("Not authorized.")
    expect(opencode.promptFromChat).not.toHaveBeenCalled()
  })

  it("text handler ignores command messages", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!
    const ctx = createTextCtx({
      userId: 1,
      chatId: 10,
      text: "/project list",
      entities: [{ type: "bot_command", offset: 0 }],
    })
    await bot.dispatchOn("text", ctx)

    expect(opencode.promptFromChat).not.toHaveBeenCalled()
    expect(state.lastBot!.telegram.sendMessage).not.toHaveBeenCalled()
  })

  it("photo handler runs download in background and replies on download timeout", async () => {
    vi.useFakeTimers()

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const fetchMock = vi.fn(async (_url: any, init?: any) => {
      const signal = init?.signal as AbortSignal | undefined
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted") as Error & { name: string }
            error.name = "AbortError"
            reject(error)
          },
          { once: true },
        )
      })
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any

    try {
      const { startBot } = await import("../src/bot.js")
      startBot(
        {
          botToken: "token",
          allowedUserId: 1,
          opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
          handlerTimeoutMs: 9999,
          promptTimeoutMs: 10_000,
          telegramDownloadTimeoutMs: 30,
        },
        opencode as any,
        projects as any,
        chatProjects as any,
        chatModels as any,
      )

      const state = (globalThis as any).__telegrafMockState as TelegrafMockState
      const bot = state.lastBot!

      const ctx = createPhotoCtx({ userId: 1, chatId: 10, messageId: 99, caption: "" })
      await bot.dispatchOn("photo", ctx)
      await flushMicrotasks()

      // Handler returned without awaiting the download.
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(30)
      await flushMicrotasks()

      expect(opencode.promptFromChat).not.toHaveBeenCalled()
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        10,
        "Failed to download file from Telegram (timed out).",
        expect.objectContaining({ reply_parameters: { message_id: 99 } }),
      )
    } finally {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    }
  })

  it("document handler replies on download failure and does not call OpenCode", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => Buffer.from([]),
    }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any

    try {
      const { startBot } = await import("../src/bot.js")
      startBot(
        {
          botToken: "token",
          allowedUserId: 1,
          opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
          handlerTimeoutMs: 9999,
          promptTimeoutMs: 10_000,
          telegramDownloadTimeoutMs: 1000,
        },
        opencode as any,
        projects as any,
        chatProjects as any,
        chatModels as any,
      )

      const state = (globalThis as any).__telegrafMockState as TelegrafMockState
      const bot = state.lastBot!

      const ctx = createDocumentCtx({
        userId: 1,
        chatId: 10,
        messageId: 50,
        mimeType: "application/pdf",
        fileName: "test.pdf",
      })
      await bot.dispatchOn("document", ctx)
      await flushMicrotasks()

      expect(opencode.promptFromChat).not.toHaveBeenCalled()
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        10,
        expect.stringContaining("Failed to download file from Telegram."),
        expect.objectContaining({ reply_parameters: { message_id: 50 } }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("document handler infers application/pdf when mime type is missing", async () => {
    let receivedInput: any

    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async (_chatId: number, input: any) => {
        receivedInput = input
        return { reply: "ok", model: null }
      }),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }

    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from([0x25, 0x50, 0x44, 0x46]),
    }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any

    try {
      const { startBot } = await import("../src/bot.js")
      startBot(
        {
          botToken: "token",
          allowedUserId: 1,
          opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
          handlerTimeoutMs: 9999,
          promptTimeoutMs: 10_000,
          telegramDownloadTimeoutMs: 1000,
        },
        opencode as any,
        projects as any,
        chatProjects as any,
        chatModels as any,
      )

      const state = (globalThis as any).__telegrafMockState as TelegrafMockState
      const bot = state.lastBot!

      const ctx = createDocumentCtx({
        userId: 1,
        chatId: 10,
        messageId: 51,
        mimeType: undefined,
        fileName: "report.PDF",
      })

      await bot.dispatchOn("document", ctx)
      await flushMicrotasks()
      await flushMicrotasks()

      expect(opencode.promptFromChat).toHaveBeenCalledTimes(1)
      expect(receivedInput.files?.[0]?.mime).toBe("application/pdf")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("text handler errors: missing chat / missing project / OpenCode failure", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: vi.fn(
        (): { alias: string; path: string } | null => ({
          alias: "home",
          path: "/home/user",
        }),
      ),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )
    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const missingChat = createTextCtx({ userId: 1, text: "hello" })
    await bot.dispatchOn("text", missingChat)
    expect(missingChat.reply).toHaveBeenCalledWith("Missing chat context.")

    projects.getProject.mockReturnValueOnce(null)
    const missingProject = createTextCtx({ userId: 1, chatId: 10, text: "hello" })
    await bot.dispatchOn("text", missingProject)
    expect(missingProject.reply).toHaveBeenCalledWith("Missing project configuration.")

    opencode.promptFromChat.mockRejectedValueOnce(new Error("boom"))
    const openCodeError = createTextCtx({ userId: 1, chatId: 10, text: "hello" })
    await bot.dispatchOn("text", openCodeError)
    await flushMicrotasks()
    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledWith(
      10,
      "OpenCode error. Check server logs.",
      expect.anything(),
    )
  })

  it("sendReply splits long replies into multiple Telegram messages", async () => {
    const longReply = "a".repeat(5000)
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: longReply, model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!
    const ctx = createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 42 })
    await bot.dispatchOn("text", ctx)
    await flushMicrotasks()

    const calls = state.lastBot!.telegram.sendMessage.mock.calls
    expect(calls.length).toBe(2)
    expect(calls[0][0]).toBe(10)
    expect(calls[0][1].length).toBeLessThanOrEqual(4096)
    expect(calls[0][2]).toEqual({ reply_parameters: { message_id: 42 } })
    expect(calls[1][0]).toBe(10)
    expect(calls[1][1].length).toBeLessThanOrEqual(4096)
    expect(calls[1][2]).toBeUndefined()
  })

  it("sendReply chunking preserves content and only replies-to on first chunk", async () => {
    const reply = "0123456789".repeat(500) // 5000 chars -> 2 chunks
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply, model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    const ctx = createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 77 })
    await bot.dispatchOn("text", ctx)
    await flushMicrotasks()

    const calls = state.lastBot!.telegram.sendMessage.mock.calls
    const sentText = calls.map((call) => call[1]).join("")
    expect(sentText).toBe(reply)
    expect(calls[0][2]).toEqual({ reply_parameters: { message_id: 77 } })
    expect(calls[1][2]).toBeUndefined()
  })

  it("sendReply skips reply_parameters when replyToMessageId is falsy", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )
    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await bot.dispatchOn("text", createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 0 }))
    await flushMicrotasks()

    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledWith(10, "hi", undefined)
  })

  it("sendReply handles sendMessage failures without crashing the handler", async () => {
    const opencode = {
      ensureSessionId: vi.fn(async () => "session-1"),
      promptFromChat: vi.fn(async () => ({ reply: "a".repeat(5000), model: null })),
      abortSession: vi.fn(async () => true),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    state.lastBot!.telegram.sendMessage
      .mockImplementationOnce(async () => ({ message_id: 1 }))
      .mockImplementationOnce(async () => {
        throw new Error("send failed")
      })

    await bot.dispatchOn(
      "text",
      createTextCtx({ userId: 1, chatId: 10, text: "hello", messageId: 9 }),
    )
    await flushMicrotasks()

    expect(state.lastBot!.telegram.sendMessage).toHaveBeenCalledTimes(2)
  })

  it("permission event is ignored for unknown session owner", async () => {
    const permissionHandlers: { onPermissionAsked?: any } = {}

    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn((handlers: any) => {
        permissionHandlers.onPermissionAsked = handlers.onPermissionAsked
        return { stop: () => undefined }
      }),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await permissionHandlers.onPermissionAsked({
      request: {
        id: "perm-unknown",
        sessionID: "session-unknown",
        permission: "fs.write",
        patterns: [],
        always: [],
      },
      directory: "/home/user",
    })

    expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
  })

  it("callback_query errors: unauthorized / request missing / reply failure", async () => {
    const permissionHandlers: { onPermissionAsked?: any } = {}

    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => ({ chatId: 10, projectDir: "/home/user" })),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => {
        throw new Error("boom")
      }),
      startEventStream: vi.fn((handlers: any) => {
        permissionHandlers.onPermissionAsked = handlers.onPermissionAsked
        return { stop: () => undefined }
      }),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!

    await permissionHandlers.onPermissionAsked({
      request: {
        id: "perm-1",
        sessionID: "session-1",
        permission: "fs.write",
        patterns: [],
        always: [],
      },
      directory: "/home/user",
    })

    const unauthorized = createCallbackCtx({
      userId: 2,
      chatId: 10,
      data: "perm:perm-1:once",
    })
    await bot.dispatchOn("callback_query", unauthorized)
    expect(unauthorized.answerCbQuery).toHaveBeenCalledWith("Not authorized.")

    const missingRequest = createCallbackCtx({
      userId: 1,
      chatId: 10,
      data: "perm:missing:once",
    })
    await bot.dispatchOn("callback_query", missingRequest)
    expect(missingRequest.answerCbQuery).toHaveBeenCalledWith(
      "Permission request not found.",
    )

    const failingReply = createCallbackCtx({
      userId: 1,
      chatId: 10,
      data: "perm:perm-1:once",
    })
    await bot.dispatchOn("callback_query", failingReply)
    expect(failingReply.answerCbQuery).toHaveBeenCalledWith("Failed to send response.")
  })

  it("reboot/restart error paths reply with failure messages", async () => {
    const childProcess = await import("node:child_process")
    const exec = childProcess.exec as unknown as ReturnType<typeof vi.fn>
    exec.mockImplementationOnce(
      (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        const err: any = new Error("fail")
        err.stderr = "bad"
        cb(err, "", "bad")
      },
    )
    exec.mockImplementationOnce(
      (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        const err: any = new Error("fail")
        err.stderr = "bad"
        cb(err, "", "bad")
      },
    )

    const opencode = {
      promptFromChat: vi.fn(async () => ({ reply: "hi", model: null })),
      resetSession: vi.fn(() => false),
      resetAllSessions: vi.fn(() => undefined),
      getSessionOwner: vi.fn(() => null),
      listModels: vi.fn(async () => []),
      replyToPermission: vi.fn(async () => true),
      startEventStream: vi.fn(() => ({ stop: () => undefined })),
    }
    const projects = {
      listProjects: () => [{ alias: "home", path: "/home/user" }],
      getProject: () => ({ alias: "home", path: "/home/user" }),
      addProject: vi.fn(),
      removeProject: vi.fn(),
    }
    const chatProjects = { getActiveAlias: () => null, setActiveAlias: vi.fn() }
    const chatModels = {
      getModel: () => null,
      setModel: vi.fn(),
      clearModel: vi.fn(),
      clearAll: vi.fn(),
    }

    const { startBot } = await import("../src/bot.js")
    startBot(
      {
        botToken: "token",
        allowedUserId: 1,
        opencode: { serverUrl: "http://localhost", serverUsername: "opencode" },
        handlerTimeoutMs: 9999,
        promptTimeoutMs: 1000,
        opencodeRestart: { command: "echo reboot", timeoutMs: 1000 },
        bridgeRestart: { command: "echo restart", timeoutMs: 1000 },
      },
      opencode as any,
      projects as any,
      chatProjects as any,
      chatModels as any,
    )

    const state = (globalThis as any).__telegrafMockState as TelegrafMockState
    const bot = state.lastBot!
    const reboot = createTextCtx({ userId: 1, chatId: 10, text: "/reboot" })
    await bot.dispatchCommand("reboot", reboot)
    expect(reboot.reply).toHaveBeenCalledWith(expect.stringContaining("OpenCode restart failed."))

    const restart = createTextCtx({ userId: 1, chatId: 10, text: "/restart" })
    await bot.dispatchCommand("restart", restart)
    expect(restart.reply).toHaveBeenCalledWith(expect.stringContaining("Bridge restart failed."))
  })
})
