import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { Part } from "@opencode-ai/sdk/v2"

import type { OpencodeConfig } from "./config.js"

export type OpencodeBridge = {
  promptFromChat: (
    chatId: number,
    text: string,
    projectDir: string,
    options?: PromptOptions,
  ) => Promise<string>
  resetSession: (chatId: number, projectDir: string) => boolean
}

export type SessionStore = {
  getSessionId: (chatId: number, projectDir: string) => string | undefined
  setSessionId: (chatId: number, projectDir: string, sessionId: string) => void
  clearSession: (chatId: number, projectDir: string) => boolean
}

export type OpencodeBridgeOptions = {
  sessionStore?: SessionStore
}

export type PromptOptions = {
  signal?: AbortSignal
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

  return {
    getSessionId: (chatId, projectDir) =>
      sessions.get(buildSessionKey(chatId, projectDir)),
    setSessionId: (chatId, projectDir, sessionId) => {
      sessions.set(buildSessionKey(chatId, projectDir), sessionId)
    },
    clearSession: (chatId, projectDir) =>
      sessions.delete(buildSessionKey(chatId, projectDir)),
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
  }
}
