import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type {
  AssistantMessage,
  Config,
  GlobalEvent,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Provider,
} from "@opencode-ai/sdk/v2"

import type { OpencodeConfig } from "./config.js"
import {
  OpencodeConfigError,
  OpencodeModelCapabilityError,
  OpencodeModelFormatError,
  OpencodeModelModalitiesError,
  OpencodeRequestError,
} from "./errors.js"

export type OpencodeBridge = {
  getSessionId: (chatId: number, projectDir: string) => string | undefined
  ensureSessionId: (chatId: number, projectDir: string) => Promise<string>
  promptFromChat: (
    chatId: number,
    input: PromptInput,
    projectDir: string,
    options?: PromptOptions,
  ) => Promise<PromptResult>
  getLatestAssistantStats: (
    sessionId: string,
    projectDir: string,
  ) => Promise<LatestAssistantStats>
  abortSession: (sessionId: string, projectDir: string) => Promise<boolean>
  resetSession: (chatId: number, projectDir: string) => boolean
  resetAllSessions: () => void
  getSessionOwner: (sessionId: string) => SessionOwner | null
  listModels: (projectDir: string) => Promise<Provider[]>
  replyToPermission: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
  ) => Promise<boolean>
  replyToQuestion: (
    requestId: string,
    answers: QuestionAnswers,
    directory?: string,
  ) => Promise<boolean>
  rejectQuestion: (requestId: string, directory?: string) => Promise<boolean>
  startEventStream: (handlers: EventStreamHandlers) => {
    stop: () => void
  }
}

export type SessionStore = {
  getSessionId: (chatId: number, projectDir: string) => string | undefined
  setSessionId: (chatId: number, projectDir: string, sessionId: string) => void
  clearSession: (chatId: number, projectDir: string) => boolean
  clearAll: () => void
  getSessionOwner: (sessionId: string) => SessionOwner | null
}

export type OpencodeBridgeOptions = {
  sessionStore?: SessionStore
}

export type PromptOptions = {
  signal?: AbortSignal
  model?: ModelRef
  sessionId?: string
}

export type PromptInput = {
  text: string
  files?: Array<{
    mime: string
    filename?: string
    dataUrl: string
  }>
}

export type PermissionReply = "once" | "always" | "reject"

export type SessionOwner = {
  chatId: number
  projectDir: string
}

export type ModelRef = {
  providerID: string
  modelID: string
}

export type PromptResult = {
  reply: string
  model: ModelRef | null
}

export type AssistantTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export type LatestAssistantStats = {
  model: ModelRef | null
  tokens: AssistantTokenUsage | null
}

export type PermissionEventHandlers = {
  onPermissionAsked: (event: {
    request: PermissionRequest
    directory: string
  }) => void | Promise<void>
  onError?: (error: unknown) => void
}

export type QuestionAnswers = Array<Array<string>>

export type EventStreamHandlers = {
  onPermissionAsked?: (event: {
    request: PermissionRequest
    directory: string
  }) => void | Promise<void>
  onQuestionAsked?: (event: {
    request: QuestionRequest
    directory: string
  }) => void | Promise<void>
  onError?: (error: unknown) => void
}

const buildBasicAuthHeader = (username: string, password: string) => {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64")
  return `Basic ${encoded}`
}

const extractText = (parts: Part[]) => {
  const textParts = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)

  return textParts.join("\n").trim()
}

const extractProviderErrorFromParts = (parts: Part[]): string | null => {
  const retries = parts.filter((part) => part.type === "retry") as Array<
    Part & {
      type: "retry"
      error?: unknown
    }
  >

  if (retries.length === 0) {
    return null
  }

  const last = retries[retries.length - 1]
  const error = last?.error
  if (!error || typeof error !== "object") {
    return "OpenCode reported a provider error, but error details were missing."
  }

  const name = (error as { name?: unknown }).name
  const data = (error as { data?: unknown }).data
  const message =
    data && typeof data === "object" ? (data as { message?: unknown }).message : undefined
  const statusCode =
    data && typeof data === "object" ? (data as { statusCode?: unknown }).statusCode : undefined

  const baseMessage = typeof message === "string" && message.trim() ? message.trim() : null
  if (!baseMessage) {
    return typeof name === "string" && name.trim()
      ? `OpenCode provider error: ${name}`
      : "OpenCode reported a provider error, but error details were missing."
  }

  if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
    return `OpenCode provider error (${statusCode}): ${baseMessage}`
  }

  return `OpenCode provider error: ${baseMessage}`
}

const extractProviderErrorFromAssistantInfo = (info: unknown): string | null => {
  if (!info || typeof info !== "object") {
    return null
  }

  const error = (info as { error?: unknown }).error
  if (!error || typeof error !== "object") {
    return null
  }

  const name = (error as { name?: unknown }).name
  const data = (error as { data?: unknown }).data
  const message =
    data && typeof data === "object" ? (data as { message?: unknown }).message : undefined
  const statusCode =
    data && typeof data === "object" ? (data as { statusCode?: unknown }).statusCode : undefined

  const baseMessage = typeof message === "string" && message.trim() ? message.trim() : null
  if (!baseMessage) {
    return typeof name === "string" && name.trim()
      ? `OpenCode provider error: ${name}`
      : "OpenCode reported a provider error, but error details were missing."
  }

  if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
    return `OpenCode provider error (${statusCode}): ${baseMessage}`
  }

  return `OpenCode provider error: ${baseMessage}`
}

const requireData = <T>(
  result: { data?: T; error?: unknown },
  label: string,
): NonNullable<T> => {
  if (result.data == null) {
    throw new OpencodeRequestError(`OpenCode ${label} failed`)
  }

  return result.data as NonNullable<T>
}

const parseModelRef = (value: string): ModelRef => {
  const [providerID, modelID] = value.split("/")
  if (!providerID || !modelID) {
    throw new OpencodeModelFormatError(`Unexpected OpenCode model format: ${value}`)
  }

  return { providerID, modelID }
}

const modelSupportsImageInput = (providers: Provider[], model: ModelRef): boolean => {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) {
    return false
  }

  const info = provider.models[model.modelID]
  if (!info) {
    return false
  }

  return Boolean(info.capabilities?.input?.image)
}

const modelSupportsPdfInput = (providers: Provider[], model: ModelRef): boolean => {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) {
    return false
  }

  const info = provider.models[model.modelID]
  if (!info) {
    return false
  }

  const capabilities = (info as { capabilities?: unknown }).capabilities
  if (capabilities && typeof capabilities === "object") {
    const input = (capabilities as { input?: unknown }).input
    if (input && typeof input === "object") {
      const pdf = (input as { pdf?: unknown }).pdf
      if (typeof pdf === "boolean") {
        return pdf
      }
    }
  }

  const modalities = (info as { modalities?: unknown }).modalities
  if (!modalities || typeof modalities !== "object") {
    throw new OpencodeModelModalitiesError(
      "Model does not expose modalities, can't check for PDF support",
    )
  }

  const input = (modalities as { input?: unknown }).input
  if (!Array.isArray(input)) {
    throw new OpencodeModelModalitiesError(
      "Model does not expose modalities, can't check for PDF support",
    )
  }

  return input.includes("pdf")
}

const resolveDefaultModel = (config: Config): ModelRef => {
  const model = config.model
  if (!model) {
    throw new OpencodeConfigError(
      "OpenCode config has no default model configured",
    )
  }

  return parseModelRef(model)
}

const buildSessionKey = (chatId: number, projectDir: string) =>
  `${chatId}\u0000${projectDir}`

export const createSessionStore = (): SessionStore => {
  const sessions = new Map<string, string>()
  const owners = new Map<string, SessionOwner>()

  return {
    getSessionId: (chatId, projectDir) =>
      sessions.get(buildSessionKey(chatId, projectDir)),
    setSessionId: (chatId, projectDir, sessionId) => {
      const sessionKey = buildSessionKey(chatId, projectDir)
      const existing = sessions.get(sessionKey)
      if (existing && existing !== sessionId) {
        owners.delete(existing)
      }

      sessions.set(sessionKey, sessionId)
      owners.set(sessionId, { chatId, projectDir })
    },
    clearSession: (chatId, projectDir) => {
      const sessionKey = buildSessionKey(chatId, projectDir)
      const existing = sessions.get(sessionKey)
      if (existing) {
        owners.delete(existing)
      }

      return sessions.delete(sessionKey)
    },
    clearAll: () => {
      sessions.clear()
      owners.clear()
    },
    getSessionOwner: (sessionId) => owners.get(sessionId) ?? null,
  }
}

export const createOpencodeBridge = (
  config: OpencodeConfig,
  options: OpencodeBridgeOptions = {},
): OpencodeBridge => {
  const headers: Record<string, string> = {}
  if (config.serverPassword) {
    headers.Authorization = buildBasicAuthHeader(
      config.serverUsername,
      config.serverPassword,
    )
  }

  const client = createOpencodeClient({
    baseUrl: config.serverUrl,
    headers,
  })

  const sessions = options.sessionStore ?? createSessionStore()

  const ensureSession = async (chatId: number, projectDir: string) => {
    const existing = sessions.getSessionId(chatId, projectDir)
    if (existing) {
      return existing
    }

    const sessionResult = await client.session.create({
      directory: projectDir,
      title: `Telegram chat ${chatId}`,
    })
    const session = requireData(sessionResult, "session.create")

    sessions.setSessionId(chatId, projectDir, session.id)
    return session.id
  }

  return {
    getSessionId(chatId, projectDir) {
      return sessions.getSessionId(chatId, projectDir)
    },
    async ensureSessionId(chatId, projectDir) {
      return ensureSession(chatId, projectDir)
    },
    async promptFromChat(chatId, input, projectDir, options = {}) {
      const sessionId = options.sessionId ?? (await ensureSession(chatId, projectDir))

      /*
       * The AbortSignal only cancels the HTTP request. The server may continue
       * processing, but the client stops waiting and the bot can move on.
       */
      const requestOptions = options.signal
        ? { signal: options.signal }
        : undefined

      const text = input.text
      const files = input.files ?? []

      if (files.length > 0) {
        const needsImageSupport = files.some((file) => file.mime.startsWith("image/"))
        const needsPdfSupport = files.some((file) => file.mime === "application/pdf")

        const model = options.model
          ? options.model
          : resolveDefaultModel(
              requireData(
                await client.config.get({ directory: projectDir }),
                "config.get",
              ),
            )
        const providerResult = await client.config.providers({ directory: projectDir })
        const providerData = requireData(providerResult, "config.providers")
        const providers = providerData.providers

        if (needsImageSupport && !modelSupportsImageInput(providers, model)) {
          throw new OpencodeModelCapabilityError(
            `Model ${model.providerID}/${model.modelID} does not support image input.`,
          )
        }

        if (needsPdfSupport && !modelSupportsPdfInput(providers, model)) {
          throw new OpencodeModelCapabilityError(
            `Model ${model.providerID}/${model.modelID} does not support PDF input.`,
          )
        }
      }

      const body: {
        sessionID: string
        directory: string
        model?: ModelRef
        parts: Array<
          | { type: "text"; text: string }
          | { type: "file"; mime: string; filename?: string; url: string }
        >
      } = {
        sessionID: sessionId,
        directory: projectDir,
        parts: [{ type: "text", text }],
      }

      for (const file of files) {
        body.parts.push({
          type: "file",
          mime: file.mime,
          ...(file.filename ? { filename: file.filename } : {}),
          url: file.dataUrl,
        })
      }

      if (options.model) {
        body.model = options.model
      }

      const responseResult = await client.session.prompt(body, requestOptions)
      const response = requireData(responseResult, "session.prompt")
      const reply = extractText(response.parts)
      if (!reply) {
        const providerError =
          extractProviderErrorFromAssistantInfo(response.info) ??
          extractProviderErrorFromParts(response.parts)

        throw new OpencodeRequestError(
          providerError ??
            "OpenCode returned no text output and did not include an error payload. This usually means the upstream provider failed; check the OpenCode server logs for details.",
        )
      }

      const info = response.info
      const model = info
        ? { providerID: info.providerID, modelID: info.modelID }
        : null

      return { reply, model }
    },
    async getLatestAssistantStats(sessionId, projectDir) {
      const result = await client.session.messages({
        sessionID: sessionId,
        directory: projectDir,
      })
      const messages = requireData(result, "session.messages")

      const normalizeTokens = (tokens: unknown): AssistantTokenUsage | null => {
        if (!tokens || typeof tokens !== "object") {
          return null
        }

        const input = (tokens as { input?: unknown }).input
        const output = (tokens as { output?: unknown }).output
        const reasoning = (tokens as { reasoning?: unknown }).reasoning
        const cache = (tokens as { cache?: unknown }).cache
        const cacheRead =
          cache && typeof cache === "object" ? (cache as { read?: unknown }).read : undefined
        const cacheWrite =
          cache && typeof cache === "object" ? (cache as { write?: unknown }).write : undefined

        if (
          typeof input !== "number" ||
          !Number.isFinite(input) ||
          typeof output !== "number" ||
          !Number.isFinite(output) ||
          typeof reasoning !== "number" ||
          !Number.isFinite(reasoning) ||
          typeof cacheRead !== "number" ||
          !Number.isFinite(cacheRead) ||
          typeof cacheWrite !== "number" ||
          !Number.isFinite(cacheWrite)
        ) {
          return null
        }

        return {
          input,
          output,
          reasoning,
          cache: {
            read: cacheRead,
            write: cacheWrite,
          },
        }
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const info = messages[index]?.info
        if (!info || typeof info !== "object") {
          continue
        }

        if ((info as Message).role !== "assistant") {
          continue
        }

        const assistant = info as AssistantMessage
        return {
          model: {
            providerID: assistant.providerID,
            modelID: assistant.modelID,
          },
          tokens: normalizeTokens(assistant.tokens),
        }
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const info = messages[index]?.info
        if (!info || typeof info !== "object") {
          continue
        }

        if ((info as Message).role !== "user") {
          continue
        }

        const model = (info as { model?: unknown }).model
        if (!model || typeof model !== "object") {
          continue
        }

        const providerID = (model as { providerID?: unknown }).providerID
        const modelID = (model as { modelID?: unknown }).modelID
        if (typeof providerID !== "string" || typeof modelID !== "string") {
          continue
        }

        return {
          model: { providerID, modelID },
          tokens: null,
        }
      }

      return { model: null, tokens: null }
    },
    async abortSession(sessionId, projectDir) {
      const result = await client.session.abort({
        sessionID: sessionId,
        directory: projectDir,
      })
      return requireData(result, "session.abort")
    },
    resetSession(chatId, projectDir) {
      return sessions.clearSession(chatId, projectDir)
    },
    resetAllSessions() {
      sessions.clearAll()
    },
    getSessionOwner(sessionId) {
      return sessions.getSessionOwner(sessionId)
    },
    async listModels(projectDir) {
      const result = await client.config.providers({ directory: projectDir })
      const data = requireData(result, "config.providers")
      return data.providers
    },
    async replyToPermission(requestId, reply, directory) {
      const parameters = directory
        ? { requestID: requestId, reply, directory }
        : { requestID: requestId, reply }
      const responseResult = await client.permission.reply(parameters)
      return requireData(responseResult, "permission.reply")
    },
    async replyToQuestion(requestId, answers, directory) {
      const parameters = directory
        ? { requestID: requestId, answers, directory }
        : { requestID: requestId, answers }
      const responseResult = await client.question.reply(parameters)
      return requireData(responseResult, "question.reply")
    },
    async rejectQuestion(requestId, directory) {
      const parameters = directory ? { requestID: requestId, directory } : { requestID: requestId }
      const responseResult = await client.question.reject(parameters)
      return requireData(responseResult, "question.reject")
    },
    startEventStream({ onPermissionAsked, onQuestionAsked, onError }) {
      const abortController = new AbortController()

      const run = async () => {
        while (!abortController.signal.aborted) {
          try {
            const stream = await client.global.event({
              signal: abortController.signal,
            })
            for await (const event of stream.stream) {
              if (abortController.signal.aborted) {
                return
              }

              const payload = (event as GlobalEvent).payload
              if (payload?.type === "permission.asked") {
                const permissionEvent = payload as {
                  type: "permission.asked"
                  properties: PermissionRequest
                }
                await Promise.resolve(
                  onPermissionAsked?.({
                    request: permissionEvent.properties,
                    directory: (event as GlobalEvent).directory,
                  }),
                )
                continue
              }

              if (payload?.type === "question.asked") {
                const questionEvent = payload as {
                  type: "question.asked"
                  properties: QuestionRequest
                }
                await Promise.resolve(
                  onQuestionAsked?.({
                    request: questionEvent.properties,
                    directory: (event as GlobalEvent).directory,
                  }),
                )
              }
            }
          } catch (error) {
            if (abortController.signal.aborted) {
              return
            }

            onError?.(error)
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        }
      }

      void run()

      return {
        stop: () => abortController.abort(),
      }
    },
  }
}
