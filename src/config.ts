export type BotConfig = {
  botToken: string
  allowedUserId: number
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
  return {
    botToken,
    allowedUserId,
  }
}
