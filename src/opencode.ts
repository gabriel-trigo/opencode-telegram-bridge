import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { Part } from "@opencode-ai/sdk/v2"

import type { OpencodeConfig } from "./config.js"

export type OpencodeBridge = {
  promptFromChat: (chatId: number, text: string) => Promise<string>
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

export const createOpencodeBridge = (config: OpencodeConfig): OpencodeBridge => {
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

  const sessions = new Map<number, string>()

  const ensureSession = async (chatId: number) => {
    const existing = sessions.get(chatId)
    if (existing) {
      return existing
    }

    const sessionResult = await client.session.create({
      directory: config.projectDir,
      title: `Telegram chat ${chatId}`,
    })
    const session = requireData(sessionResult, "session.create")

    sessions.set(chatId, session.id)
    return session.id
  }

  return {
    async promptFromChat(chatId, text) {
      const sessionId = await ensureSession(chatId)

      const responseResult = await client.session.prompt({
        sessionID: sessionId,
        directory: config.projectDir,
        parts: [{ type: "text", text }],
      })
      const response = requireData(responseResult, "session.prompt")
      const reply = extractText(response.parts)
      if (!reply) {
        return "OpenCode returned no text output."
      }

      return reply
    },
  }
}
