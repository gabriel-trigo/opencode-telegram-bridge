import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type {
  Config,
  GlobalEvent,
  Part,
  PermissionRequest,
  Provider,
} from "@opencode-ai/sdk/v2"

import type { OpencodeConfig } from "./config.js"

export type OpencodeBridge = {
  ensureSessionId: (chatId: number, projectDir: string) => Promise<string>
  promptFromChat: (
    chatId: number,
    input: PromptInput,
    projectDir: string,
    options?: PromptOptions,
  ) => Promise<PromptResult>
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
  startPermissionEventStream: (handlers: PermissionEventHandlers) => {
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

export type PermissionEventHandlers = {
  onPermissionAsked: (event: {
    request: PermissionRequest
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

const requireData = <T>(
  result: { data?: T; error?: unknown },
  label: string,
): NonNullable<T> => {
  if (result.data == null) {
    throw new Error(`OpenCode ${label} failed`)
  }

  return result.data as NonNullable<T>
}

const parseModelRef = (value: string): ModelRef => {
  const [providerID, modelID] = value.split("/")
  if (!providerID || !modelID) {
    throw new Error(`Unexpected OpenCode model format: ${value}`)
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

  const modalities = (info as { modalities?: unknown }).modalities
  if (!modalities || typeof modalities !== "object") {
    throw new Error("Model does not expose modalities, can't check for PDF support")
  }

  const input = (modalities as { input?: unknown }).input
  if (!Array.isArray(input)) {
    throw new Error("Model does not expose modalities, can't check for PDF support")
  }

  return input.includes("pdf")
}

const resolveDefaultModel = (config: Config): ModelRef => {
  const model = config.model
  if (!model) {
    throw new Error("OpenCode config has no default model configured")
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
          throw new Error(
            `Model ${model.providerID}/${model.modelID} does not support image input.`,
          )
        }

        if (needsPdfSupport && !modelSupportsPdfInput(providers, model)) {
          throw new Error(
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
        return { reply: "OpenCode returned no text output.", model: null }
      }

      const info = response.info
      const model = info
        ? { providerID: info.providerID, modelID: info.modelID }
        : null

      return { reply, model }
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
    startPermissionEventStream({ onPermissionAsked, onError }) {
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
              if (payload?.type !== "permission.asked") {
                continue
              }

              const permissionEvent = payload as {
                type: "permission.asked"
                properties: PermissionRequest
              }
              await Promise.resolve(
                onPermissionAsked({
                  request: permissionEvent.properties,
                  directory: (event as GlobalEvent).directory,
                }),
              )
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
