export type TelegramUser = {
  id?: number
  username?: string
}

export type BotCommandEntity = {
  type: string
  offset: number
}

export type PermissionButtonSpec = {
  text: string
  data: string
}

export type PermissionKeyboardSpec = {
  buttons: PermissionButtonSpec[]
}

export type PermissionCallback = {
  requestId: string
  reply: "once" | "always" | "reject"
}

export type QuestionCallback =
  | {
      requestId: string
      action: "option"
      optionIndex: number
    }
  | {
      requestId: string
      action: "next"
    }
  | {
      requestId: string
      action: "cancel"
    }

export type ModelProvider = {
  id: string
  models: Record<string, { name?: string } | undefined>
}

export type StatusTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export const isAuthorized = (
  user: TelegramUser | undefined,
  allowedUserId: number,
) => user?.id === allowedUserId

export const formatUserLabel = (user: TelegramUser | undefined) => {
  if (!user) {
    return "unknown"
  }

  if (user.username) {
    return `${user.username} (${user.id ?? "unknown"})`
  }

  return String(user.id ?? "unknown")
}

export const isCommandMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) {
    return false
  }

  const entities = (message as { entities?: unknown }).entities
  if (!Array.isArray(entities)) {
    return false
  }

  return entities.some(
    (entity) =>
      typeof entity === "object" &&
      entity !== null &&
      "type" in entity &&
      "offset" in entity &&
      (entity as BotCommandEntity).type === "bot_command" &&
      (entity as BotCommandEntity).offset === 0,
  )
}

export type ParsedCommand = {
  subcommand: string
  args: string[]
}

const parseCommand = (text: string, command: string): ParsedCommand => {
  const parts = text.trim().split(/\s+/)
  const head = parts.shift()
  if (!head || !head.startsWith(`/${command}`)) {
    return { subcommand: "", args: [] }
  }

  const subcommand = parts[0] ?? ""
  const args = parts.slice(1)
  return { subcommand, args }
}

export const parseProjectCommand = (text: string): ParsedCommand => {
  const parsed = parseCommand(text, "project")
  return {
    subcommand: parsed.subcommand || "list",
    args: parsed.args,
  }
}

export const parseModelCommand = (text: string): ParsedCommand => {
  const parsed = parseCommand(text, "model")
  return {
    subcommand: parsed.subcommand || "current",
    args: parsed.args,
  }
}

export const formatProjectList = (
  entries: Array<{ alias: string; path: string }>,
  activeAlias: string,
) => {
  if (entries.length === 0) {
    return "No projects configured."
  }

  const lines = entries.map((entry) => {
    const prefix = entry.alias === activeAlias ? "*" : " "
    return `${prefix} ${entry.alias}: ${entry.path}`
  })

  return ["Projects (active marked with *):", ...lines].join("\n")
}

export const formatModelList = (providers: ModelProvider[]) => {
  const lines = ["Available models:"]

  const providerEntries = [...providers].sort((a, b) => a.id.localeCompare(b.id))
  for (const provider of providerEntries) {
    const modelEntries = Object.entries(provider.models).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )
    for (const [modelId, model] of modelEntries) {
      if (!model) {
        continue
      }
      const label = model.name
        ? `${provider.id}/${modelId} (${model.name})`
        : `${provider.id}/${modelId}`
      lines.push(label)
    }
  }

  if (lines.length === 1) {
    lines.push("No models available.")
  }

  return lines.join("\n")
}

export const buildPermissionSummary = (request: {
  permission: string
  patterns: Array<string>
  always: Array<string>
}) => {
  const lines = ["OpenCode permission request", `Permission: ${request.permission}`]
  if (request.patterns.length > 0) {
    lines.push(`Patterns: ${request.patterns.join(", ")}`)
  }
  if (request.always.length > 0) {
    lines.push(`Always scopes: ${request.always.join(", ")}`)
  }

  return lines.join("\n")
}

export const buildPermissionKeyboardSpec = (
  requestId: string,
  includeAlways: boolean,
): PermissionKeyboardSpec => {
  const buttons: PermissionButtonSpec[] = [
    { text: "Approve once", data: `perm:${requestId}:once` },
    { text: "Reject", data: `perm:${requestId}:reject` },
  ]

  if (includeAlways) {
    buttons.splice(1, 0, {
      text: "Approve always",
      data: `perm:${requestId}:always`,
    })
  }

  return { buttons }
}

export const parsePermissionCallback = (data: string): PermissionCallback | null => {
  if (!data.startsWith("perm:")) {
    return null
  }

  const parts = data.split(":")
  if (parts.length !== 3) {
    return null
  }

  const [, requestId, reply] = parts
  if (!requestId) {
    return null
  }

  if (reply !== "once" && reply !== "always" && reply !== "reject") {
    return null
  }

  return { requestId, reply }
}

export const parseQuestionCallback = (data: string): QuestionCallback | null => {
  if (!data.startsWith("q:")) {
    return null
  }

  const parts = data.split(":")
  if (parts.length < 3) {
    return null
  }

  const [, requestId, action] = parts
  if (!requestId || !action) {
    return null
  }

  if (action === "next") {
    return { requestId, action: "next" }
  }

  if (action === "cancel") {
    return { requestId, action: "cancel" }
  }

  if (action === "opt") {
    if (parts.length !== 4) {
      return null
    }

    const optionIndexRaw = parts[3]
    const optionIndex = Number(optionIndexRaw)
    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      return null
    }

    return { requestId, action: "option", optionIndex }
  }

  return null
}

export const formatPermissionDecision = (reply: PermissionCallback["reply"]) =>
  reply === "reject"
    ? "Rejected"
    : reply === "always"
      ? "Approved (always)"
      : "Approved (once)"

export const formatCommandOutput = (value: string | undefined) => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const maxLength = 800
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength)}...`
}

const formatPercentage = (value: number) => {
  if (!Number.isFinite(value)) {
    return "?%"
  }

  return `${(value * 100).toFixed(1)}%`
}

export const formatStatusReply = (status: {
  project: { alias: string; path: string }
  sessionId: string | null
  model: { providerID: string; modelID: string } | null
  tokens: StatusTokenUsage | null
  contextLimit: number | null
}) => {
  const lines: string[] = []
  lines.push(`Project: ${status.project.alias}: ${status.project.path}`)

  lines.push(
    status.model
      ? `Model: ${status.model.providerID}/${status.model.modelID}`
      : "Model: (unknown yet)",
  )

  lines.push(status.sessionId ? `Session: ${status.sessionId}` : "Session: (no session yet)")

  if (!status.tokens) {
    const reason = status.sessionId ? "no assistant message yet" : "no session yet"
    const suffix =
      status.contextLimit != null
        ? ` Limit: ${status.contextLimit}`
        : ""
    lines.push(`Context (input): unavailable (${reason}).${suffix}`)
    return lines.join("\n")
  }

  if (status.contextLimit != null && status.contextLimit > 0) {
    const ratio = status.tokens.input / status.contextLimit
    lines.push(
      `Context (input): ${status.tokens.input} / ${status.contextLimit} (${formatPercentage(ratio)})`,
    )
  } else {
    lines.push(`Context (input): ${status.tokens.input} (limit unknown)`)
  }

  lines.push(
    `Tokens (last assistant): in=${status.tokens.input} out=${status.tokens.output} reasoning=${status.tokens.reasoning} cache(r/w)=${status.tokens.cache.read}/${status.tokens.cache.write}`,
  )

  return lines.join("\n")
}
