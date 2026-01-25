export type BotConfig = {
  botToken: string
  allowedUserId: number
  opencode: OpencodeConfig
}

export type OpencodeConfig = {
  serverUrl: string
  projectDir: string
  serverUsername: string
  serverPassword?: string
}

const parseAllowedUserId = (rawValue: string | undefined): number => {
  if (!rawValue) {
    throw new Error("Missing TELEGRAM_ALLOWED_USER_ID")
  }

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue)) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID must be an integer")
  }

  return parsedValue
}

export const loadConfig = (): BotConfig => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN")
  }

  const allowedUserId = parseAllowedUserId(process.env.TELEGRAM_ALLOWED_USER_ID)
  const serverUrl = process.env.OPENCODE_SERVER_URL
  if (!serverUrl) {
    throw new Error("Missing OPENCODE_SERVER_URL")
  }

  const projectDir = process.env.OPENCODE_PROJECT_DIR
  if (!projectDir) {
    throw new Error("Missing OPENCODE_PROJECT_DIR")
  }

  const opencode: OpencodeConfig = {
    serverUrl,
    projectDir,
    serverUsername: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
  }

  const serverPassword = process.env.OPENCODE_SERVER_PASSWORD
  if (serverPassword) {
    opencode.serverPassword = serverPassword
  }

  return {
    botToken,
    allowedUserId,
    opencode,
  }
}
