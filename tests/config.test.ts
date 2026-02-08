import { afterEach, describe, expect, it } from "vitest"

import { loadConfig } from "../src/config.js"
import { ConfigError, ConfigValidationError } from "../src/errors.js"

const originalEnv = { ...process.env }

const restoreEnv = () => {
  const keys = new Set([
    ...Object.keys(process.env),
    ...Object.keys(originalEnv),
  ])
  for (const key of keys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

const setEnv = (updates: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

describe("loadConfig", () => {
  it("throws when TELEGRAM_BOT_TOKEN is missing", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigError)
    expect(run).toThrowError("Missing TELEGRAM_BOT_TOKEN")
  })

  it("throws when TELEGRAM_ALLOWED_USER_ID is missing", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: undefined,
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigError)
    expect(run).toThrowError("Missing TELEGRAM_ALLOWED_USER_ID")
  })

  it("throws when TELEGRAM_ALLOWED_USER_ID is not an integer", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "nope",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigValidationError)
    expect(run).toThrowError(
      "TELEGRAM_ALLOWED_USER_ID must be an integer",
    )
  })

  it("throws when OPENCODE_SERVER_URL is missing", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: undefined,
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigError)
    expect(run).toThrowError("Missing OPENCODE_SERVER_URL")
  })

  it("loads config with defaults", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_SERVER_USERNAME: undefined,
      OPENCODE_SERVER_PASSWORD: undefined,
      OPENCODE_PROMPT_TIMEOUT_MS: undefined,
      TELEGRAM_HANDLER_TIMEOUT_MS: undefined,
      TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS: undefined,
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const config = loadConfig()
    const promptTimeoutMs = 10 * 60 * 1000

    expect(config.botToken).toBe("token")
    expect(config.allowedUserId).toBe(42)
    expect(config.opencode.serverUrl).toBe("http://localhost:4096")
    expect(config.opencode.serverUsername).toBe("opencode")
    expect(config.opencode.serverPassword).toBeUndefined()
    expect(config.promptTimeoutMs).toBe(promptTimeoutMs)
    expect(config.handlerTimeoutMs).toBe(promptTimeoutMs + 30_000)
    expect(config.telegramDownloadTimeoutMs).toBe(30_000)
    expect(config.opencodeRestart).toBeUndefined()
  })

  it("loads config with basic auth password", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_SERVER_USERNAME: "custom",
      OPENCODE_SERVER_PASSWORD: "secret",
      OPENCODE_PROMPT_TIMEOUT_MS: "120000",
      TELEGRAM_HANDLER_TIMEOUT_MS: "300000",
      TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS: "1234",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const config = loadConfig()

    expect(config.opencode.serverUsername).toBe("custom")
    expect(config.opencode.serverPassword).toBe("secret")
    expect(config.promptTimeoutMs).toBe(120000)
    expect(config.handlerTimeoutMs).toBe(300000)
    expect(config.telegramDownloadTimeoutMs).toBe(1234)
  })

  it("loads restart command when configured", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: "systemctl restart opencode",
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const config = loadConfig()

    expect(config.opencodeRestart).toEqual({
      command: "systemctl restart opencode",
      timeoutMs: 30_000,
    })
  })

  it("throws when restart timeout is set without a command", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: "5000",
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigValidationError)
    expect(run).toThrowError(
      "OPENCODE_RESTART_TIMEOUT_MS requires OPENCODE_RESTART_COMMAND",
    )
  })

  it("loads bridge restart command when configured", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND:
        "systemctl restart opencode-telegram-bridge",
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: undefined,
    })

    const config = loadConfig()

    expect(config.bridgeRestart).toEqual({
      command: "systemctl restart opencode-telegram-bridge",
      timeoutMs: 30_000,
    })
  })

  it("throws when bridge restart timeout is set without a command", () => {
    setEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_RESTART_COMMAND: undefined,
      OPENCODE_RESTART_TIMEOUT_MS: undefined,
      OPENCODE_BRIDGE_RESTART_COMMAND: undefined,
      OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: "5000",
    })

    const run = () => loadConfig()

    expect(run).toThrowError(ConfigValidationError)
    expect(run).toThrowError(
      "OPENCODE_BRIDGE_RESTART_TIMEOUT_MS requires OPENCODE_BRIDGE_RESTART_COMMAND",
    )
  })
})
