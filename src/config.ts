import { ConfigError, ConfigValidationError } from "./errors.js"

export type BotConfig = {
  botToken: string
  allowedUserIds: number[]
  opencode: OpencodeConfig
  handlerTimeoutMs: number
  promptTimeoutMs: number
  telegramDownloadTimeoutMs?: number
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

const parseAllowedUserIds = (env: NodeJS.ProcessEnv): number[] => {
  const rawList = env.TELEGRAM_ALLOWED_USER_IDS
  if (rawList != null && rawList.trim().length > 0) {
    const parts = rawList
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (parts.length === 0) {
      throw new ConfigValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must include at least one integer",
      )
    }

    const ids = parts.map((value) => Number(value))
    if (ids.some((value) => !Number.isInteger(value))) {
      throw new ConfigValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of integers",
      )
    }

    return ids
  }

  const rawSingle = env.TELEGRAM_ALLOWED_USER_ID
  if (!rawSingle) {
    throw new ConfigError(
      "Missing TELEGRAM_ALLOWED_USER_ID (or TELEGRAM_ALLOWED_USER_IDS)",
    )
  }

  const parsedValue = Number(rawSingle)
  if (!Number.isInteger(parsedValue)) {
    throw new ConfigValidationError("TELEGRAM_ALLOWED_USER_ID must be an integer")
  }

  return [parsedValue]
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
    throw new ConfigValidationError(`${label} must be a non-negative number`)
  }

  return parsedValue
}

export const loadConfig = (): BotConfig => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    throw new ConfigError("Missing TELEGRAM_BOT_TOKEN")
  }

  const allowedUserIds = parseAllowedUserIds(process.env)
  const serverUrl = process.env.OPENCODE_SERVER_URL
  if (!serverUrl) {
    throw new ConfigError("Missing OPENCODE_SERVER_URL")
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

  const telegramDownloadTimeoutMs =
    parseDurationMs(
      process.env.TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS,
      "TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS",
    ) ?? 30_000

  const restartCommand = process.env.OPENCODE_RESTART_COMMAND?.trim()
  const restartTimeoutMs = parseDurationMs(
    process.env.OPENCODE_RESTART_TIMEOUT_MS,
    "OPENCODE_RESTART_TIMEOUT_MS",
  )
  if (!restartCommand && restartTimeoutMs !== undefined) {
    throw new ConfigValidationError(
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
    throw new ConfigValidationError(
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
    allowedUserIds,
    opencode,
    handlerTimeoutMs,
    promptTimeoutMs,
    telegramDownloadTimeoutMs,
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
