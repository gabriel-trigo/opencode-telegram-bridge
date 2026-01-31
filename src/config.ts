export type BotConfig = {
  botToken: string
  allowedUserId: number
  opencode: OpencodeConfig
  handlerTimeoutMs: number
  promptTimeoutMs: number
  opencodeRestart?: RestartCommandConfig
  bridgeRestart?: RestartCommandConfig
}

export type OpencodeConfig = {
  serverUrl: string
  serverUsername: string
  serverPassword?: string
}

export type RestartCommandConfig = {
  command: string
  timeoutMs: number
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

const parseDurationMs = (
  rawValue: string | undefined,
  label: string,
): number | undefined => {
  if (!rawValue) {
    return undefined
  }

  const parsedValue = Number(rawValue)
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${label} must be a non-negative number`)
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

  const opencode: OpencodeConfig = {
    serverUrl,
    serverUsername: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
  }

  const serverPassword = process.env.OPENCODE_SERVER_PASSWORD
  if (serverPassword) {
    opencode.serverPassword = serverPassword
  }

  const promptTimeoutMs =
    parseDurationMs(
      process.env.OPENCODE_PROMPT_TIMEOUT_MS,
      "OPENCODE_PROMPT_TIMEOUT_MS",
    ) ?? 10 * 60 * 1000
  const handlerTimeoutMs =
    parseDurationMs(
      process.env.TELEGRAM_HANDLER_TIMEOUT_MS,
      "TELEGRAM_HANDLER_TIMEOUT_MS",
    ) ?? promptTimeoutMs + 30_000

  const restartCommand = process.env.OPENCODE_RESTART_COMMAND?.trim()
  const restartTimeoutMs = parseDurationMs(
    process.env.OPENCODE_RESTART_TIMEOUT_MS,
    "OPENCODE_RESTART_TIMEOUT_MS",
  )
  if (!restartCommand && restartTimeoutMs !== undefined) {
    throw new Error(
      "OPENCODE_RESTART_TIMEOUT_MS requires OPENCODE_RESTART_COMMAND",
    )
  }

  const opencodeRestart = restartCommand
    ? {
        command: restartCommand,
        timeoutMs: restartTimeoutMs ?? 30_000,
      }
    : undefined

  const bridgeRestartCommand = process.env.OPENCODE_BRIDGE_RESTART_COMMAND?.trim()
  const bridgeRestartTimeoutMs = parseDurationMs(
    process.env.OPENCODE_BRIDGE_RESTART_TIMEOUT_MS,
    "OPENCODE_BRIDGE_RESTART_TIMEOUT_MS",
  )
  if (!bridgeRestartCommand && bridgeRestartTimeoutMs !== undefined) {
    throw new Error(
      "OPENCODE_BRIDGE_RESTART_TIMEOUT_MS requires OPENCODE_BRIDGE_RESTART_COMMAND",
    )
  }

  const bridgeRestart = bridgeRestartCommand
    ? {
        command: bridgeRestartCommand,
        timeoutMs: bridgeRestartTimeoutMs ?? 30_000,
      }
    : undefined

  const baseConfig: BotConfig = {
    botToken,
    allowedUserId,
    opencode,
    handlerTimeoutMs,
    promptTimeoutMs,
  }

  let config = baseConfig
  if (opencodeRestart) {
    config = {
      ...config,
      opencodeRestart,
    }
  }
  if (bridgeRestart) {
    config = {
      ...config,
      bridgeRestart,
    }
  }

  return config
}
