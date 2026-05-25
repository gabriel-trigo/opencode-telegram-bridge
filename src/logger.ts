import pino from "pino"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const

const parseLogLevel = (rawValue: string | undefined) => {
  if (!rawValue) {
    return "info"
  }

  const normalized = rawValue.trim().toLowerCase()
  return LOG_LEVELS.includes(normalized as (typeof LOG_LEVELS)[number])
    ? normalized
    : "info"
}

const level = parseLogLevel(process.env.LOG_LEVEL)

export const logger = pino(
  {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(
    [
      { level: "trace", stream: process.stdout },
      { level: "error", stream: process.stderr },
    ],
    { dedupe: true },
  ),
)

export const flushLogger = () => {
  logger.flush()
}
