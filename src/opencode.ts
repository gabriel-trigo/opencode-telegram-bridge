import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent, Part, PermissionRequest } from "@opencode-ai/sdk/v2"

import type { OpencodeConfig } from "./config.js"

export type OpencodeBridge = {
  promptFromChat: (
    chatId: number,
    text: string,
    projectDir: string,
    options?: PromptOptions,
  ) => Promise<string>
  resetSession: (chatId: number, projectDir: string) => boolean
  resetAllSessions: () => void
  getSessionOwner: (sessionId: string) => SessionOwner | null
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
}

export type PermissionReply = "once" | "always" | "reject"

export type SessionOwner = {
  chatId: number
  projectDir: string
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
    async promptFromChat(chatId, text, projectDir, options = {}) {
      const sessionId = await ensureSession(chatId, projectDir)

      /*
       * The AbortSignal only cancels the HTTP request. The server may continue
       * processing, but the client stops waiting and the bot can move on.
       */
      const requestOptions = options.signal
        ? { signal: options.signal }
        : undefined

      const responseResult = await client.session.prompt(
        {
          sessionID: sessionId,
          directory: projectDir,
          parts: [{ type: "text", text }],
        },
        requestOptions,
      )
      const response = requireData(responseResult, "session.prompt")
      const reply = extractText(response.parts)
      if (!reply) {
        return "OpenCode returned no text output."
      }

      return reply
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
