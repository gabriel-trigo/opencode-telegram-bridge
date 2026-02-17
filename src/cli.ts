import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { fileURLToPath } from "node:url"

import { runBot } from "./run.js"
import {
  CliCommandError,
  CliInputError,
  CliNotFoundError,
  CliValidationError,
} from "./errors.js"

const die = (message: string) => {
  console.error(message)
  process.exit(1)
}

const runCommand = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
  })

  if (result.status !== 0) {
    throw new CliCommandError(`Command failed: ${command} ${args.join(" ")}`)
  }
}

const resolveExecStart = () => {
  const nodePath = process.execPath
  const cliPath = fileURLToPath(import.meta.url)
  return { nodePath, cliPath }
}

const resolveOpencodePath = () => {
  const result = spawnSync("sh", ["-c", "command -v opencode"], {
    encoding: "utf8",
  })

  const opencodePath = result.stdout.trim()
  if (!opencodePath || result.status !== 0) {
    throw new CliNotFoundError("opencode CLI not found in PATH")
  }

  return opencodePath
}

const readAnswer = async (
  prompt: string,
  options: { required?: boolean; defaultValue?: string } = {},
) => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const suffix = options.defaultValue ? ` (${options.defaultValue})` : ""
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim()
  rl.close()

  if (!answer && options.defaultValue) {
    return options.defaultValue
  }

  if (!answer && options.required) {
    throw new CliInputError(`Missing ${prompt}`)
  }

  return answer
}

const readSecret = async (
  prompt: string,
  options: { required?: boolean; defaultValue?: string } = {},
) => {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  })
  const suffix = options.defaultValue ? ` (${options.defaultValue})` : ""
  const questionPrompt = `${prompt}${suffix}: `
  const masked = rl as ReturnType<typeof readline.createInterface> & {
    stdoutMuted?: boolean
    _writeToOutput?: (value: string) => void
  }
  const write = masked._writeToOutput?.bind(masked)
  if (write) {
    masked._writeToOutput = (value) => {
      if (!masked.stdoutMuted || value.includes(questionPrompt)) {
        write(value)
        return
      }
      write("*")
    }
    masked.stdoutMuted = true
  }
  const answer = (await rl.question(questionPrompt)).trim()
  if (masked.stdoutMuted) {
    masked.stdoutMuted = false
    stdout.write("\n")
  }
  rl.close()

  if (!answer && options.defaultValue) {
    return options.defaultValue
  }

  if (!answer && options.required) {
    throw new CliInputError(`Missing ${prompt}`)
  }

  return answer
}

const confirmAnswer = async (prompt: string, defaultValue = false) => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const suffix = defaultValue ? "(Y/n)" : "(y/N)"
  const answer = (await rl.question(`${prompt} ${suffix}: `)).trim()
  rl.close()

  if (!answer) {
    return defaultValue
  }

  return answer.toLowerCase().startsWith("y")
}

const writeEnvFile = (envPath: string, values: Record<string, string>) => {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  fs.chmodSync(envPath, 0o600)
}

const writeUnitFile = (unitPath: string, content: string) => {
  fs.mkdirSync(path.dirname(unitPath), { recursive: true })
  fs.writeFileSync(unitPath, content, "utf8")
}

const writePlistFile = (plistPath: string, content: string) => {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true })
  fs.writeFileSync(plistPath, content, { encoding: "utf8", mode: 0o600 })
  fs.chmodSync(plistPath, 0o600)
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

const buildUnitFile = (
  envPath: string,
  nodePath: string,
  cliPath: string,
) => `
[Unit]
Description=OpenCode Telegram Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${envPath}
ExecStart=${nodePath} ${cliPath}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`

const buildOpencodeUnitFile = (opencodePath: string, nodeDir: string) => `
[Unit]
Description=OpenCode Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin
ExecStart=${opencodePath} serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`

const buildLaunchdPlist = ({
  label,
  programArguments,
  env,
  logPath,
}: {
  label: string
  programArguments: string[]
  env: Record<string, string>
  logPath: string
}) => {
  const envEntries = Object.entries(env)
    .filter(([, value]) => value)
    .map(
      ([key, value]) =>
        `      <key>${escapeXml(key)}</key>\n      <string>${escapeXml(value)}</string>`,
    )
    .join("\n")
  const envBlock = envEntries
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envEntries}\n  </dict>\n`
    : ""
  const programArgs = programArguments
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
${envBlock}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`
}

const buildLaunchdPath = (nodeDir: string) =>
  [nodeDir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(
    ":",
  )

const isLaunchdServiceLoaded = (uid: number, label: string) => {
  const result = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], {
    encoding: "utf8",
  })
  return result.status === 0
}

const runSystemdSetup = async () => {

  const systemctlCheck = spawnSync("systemctl", ["--user", "--version"], {
    encoding: "utf8",
  })
  if (systemctlCheck.status !== 0) {
    die("systemctl --user is not available. Install systemd or use manual setup.")
  }

  const homeDir = os.homedir()
  const envPath = path.join(
    homeDir,
    ".config",
    "opencode-telegram-bridge",
    "opencode-telegram-bridge.env",
  )
  const unitPath = path.join(
    homeDir,
    ".config",
    "systemd",
    "user",
    "opencode-telegram-bridge.service",
  )

  const installOpencode = await confirmAnswer(
    "Set up OpenCode server as a user service?",
    false,
  )

  const opencodeUnitPath = path.join(
    homeDir,
    ".config",
    "systemd",
    "user",
    "opencode.service",
  )
  const existingPaths = [envPath, unitPath]
  if (installOpencode) {
    existingPaths.push(opencodeUnitPath)
  }

  if (existingPaths.some((filePath) => fs.existsSync(filePath))) {
    const overwrite = await confirmAnswer(
      "Existing config found. Overwrite?",
      false,
    )
    if (!overwrite) {
      die("Setup cancelled.")
    }
  }

  const opencodePath = installOpencode ? resolveOpencodePath() : null

  const botToken = await readSecret("TELEGRAM_BOT_TOKEN", { required: true })
  const allowedUserIdsRaw = await readAnswer("TELEGRAM_ALLOWED_USER_IDS", {})
  const parseUserIds = (raw: string) => {
    const parts = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (parts.length === 0) {
      throw new CliValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must include at least one integer",
      )
    }
    const ids = parts.map((value) => Number(value))
    if (ids.some((value) => !Number.isInteger(value))) {
      throw new CliValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of integers",
      )
    }
    return ids
  }

  const allowedUserIds = allowedUserIdsRaw.trim() ? parseUserIds(allowedUserIdsRaw) : null
  const allowedUserId =
    allowedUserIds === null
      ? await readAnswer("TELEGRAM_ALLOWED_USER_ID", { required: true })
      : null
  if (allowedUserId !== null && !Number.isInteger(Number(allowedUserId))) {
    throw new CliValidationError("TELEGRAM_ALLOWED_USER_ID must be an integer")
  }
  const serverUrl = await readAnswer("OPENCODE_SERVER_URL", {
    defaultValue: "http://127.0.0.1:4096",
  })
  const serverUsername = await readAnswer("OPENCODE_SERVER_USERNAME", {
    defaultValue: "opencode",
  })
  const serverPassword = await readSecret("OPENCODE_SERVER_PASSWORD", {})
  const opencodeRestartCommand = installOpencode
    ? "systemctl --user restart opencode --no-block"
    : await readAnswer("OPENCODE_RESTART_COMMAND", {})
  const opencodeRestartTimeoutMs = opencodeRestartCommand ? "30000" : ""

  const { nodePath, cliPath } = resolveExecStart()
  writeEnvFile(envPath, {
    TELEGRAM_BOT_TOKEN: botToken,
    ...(allowedUserIds
      ? { TELEGRAM_ALLOWED_USER_IDS: allowedUserIds.join(",") }
      : { TELEGRAM_ALLOWED_USER_ID: allowedUserId ?? "" }),
    OPENCODE_SERVER_URL: serverUrl,
    OPENCODE_SERVER_USERNAME: serverUsername,
    OPENCODE_SERVER_PASSWORD: serverPassword,
    OPENCODE_PROMPT_TIMEOUT_MS: "600000",
    TELEGRAM_HANDLER_TIMEOUT_MS: "630000",
    OPENCODE_RESTART_COMMAND: opencodeRestartCommand,
    OPENCODE_RESTART_TIMEOUT_MS: opencodeRestartTimeoutMs,
    OPENCODE_BRIDGE_RESTART_COMMAND:
      "systemctl --user restart opencode-telegram-bridge --no-block",
    OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: "30000",
  })

  const unitFile = buildUnitFile(envPath, nodePath, cliPath)
  writeUnitFile(unitPath, unitFile)

  const nodeDir = path.dirname(nodePath)
  if (installOpencode && opencodePath) {
    const opencodeUnitFile = buildOpencodeUnitFile(opencodePath, nodeDir)
    writeUnitFile(opencodeUnitPath, opencodeUnitFile)
  }

  runCommand("systemctl", ["--user", "daemon-reload"])
  if (installOpencode) {
    runCommand("systemctl", ["--user", "enable", "--now", "opencode"])
  }
  runCommand("systemctl", ["--user", "enable", "--now", "opencode-telegram-bridge"])

  const enableLinger = await confirmAnswer(
    "Enable linger so services start on boot without login?",
    false,
  )
  if (enableLinger) {
    const user = os.userInfo().username
    const result = spawnSync("sudo", ["loginctl", "enable-linger", user], {
      encoding: "utf8",
      stdio: "inherit",
    })
    if (result.status !== 0) {
      console.warn(
        `Linger could not be enabled. Services will start on login only. Run: sudo loginctl enable-linger ${user}`,
      )
    } else {
      console.log(`Linger enabled for ${user}. Services will start on boot.`)
    }
  } else {
    console.log("Linger not enabled. Services will start on login.")
  }

  console.log("Setup complete. Service is running.")
  console.log(`Env file: ${envPath}`)
  console.log(`Unit file: ${unitPath}`)
}

const runLaunchdSetup = async () => {
  const rawUid = process.getuid?.()
  if (typeof rawUid !== "number") {
    die("Unable to determine user id for launchd setup.")
    return
  }
  const uid = rawUid

  const homeDir = os.homedir()
  const envPath = path.join(
    homeDir,
    ".config",
    "opencode-telegram-bridge",
    "opencode-telegram-bridge.env",
  )
  const bridgeLabel = "com.opencode.telegram-bridge"
  const opencodeLabel = "com.opencode.server"
  const plistPath = path.join(
    homeDir,
    "Library",
    "LaunchAgents",
    `${bridgeLabel}.plist`,
  )

  const installOpencode = await confirmAnswer(
    "Set up OpenCode server as a launchd agent?",
    false,
  )

  const opencodePlistPath = path.join(
    homeDir,
    "Library",
    "LaunchAgents",
    `${opencodeLabel}.plist`,
  )

  const existingPaths = [envPath, plistPath]
  if (installOpencode) {
    existingPaths.push(opencodePlistPath)
  }

  if (existingPaths.some((filePath) => fs.existsSync(filePath))) {
    const overwrite = await confirmAnswer(
      "Existing config found. Overwrite?",
      false,
    )
    if (!overwrite) {
      die("Setup cancelled.")
    }
  }

  const opencodePath = installOpencode ? resolveOpencodePath() : null

  const botToken = await readSecret("TELEGRAM_BOT_TOKEN", { required: true })
  const allowedUserIdsRaw = await readAnswer("TELEGRAM_ALLOWED_USER_IDS", {})
  const parseUserIds = (raw: string) => {
    const parts = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (parts.length === 0) {
      throw new CliValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must include at least one integer",
      )
    }
    const ids = parts.map((value) => Number(value))
    if (ids.some((value) => !Number.isInteger(value))) {
      throw new CliValidationError(
        "TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of integers",
      )
    }
    return ids
  }

  const allowedUserIds = allowedUserIdsRaw.trim() ? parseUserIds(allowedUserIdsRaw) : null
  const allowedUserId =
    allowedUserIds === null
      ? await readAnswer("TELEGRAM_ALLOWED_USER_ID", { required: true })
      : null
  if (allowedUserId !== null && !Number.isInteger(Number(allowedUserId))) {
    throw new CliValidationError("TELEGRAM_ALLOWED_USER_ID must be an integer")
  }
  const serverUrl = await readAnswer("OPENCODE_SERVER_URL", {
    defaultValue: "http://127.0.0.1:4096",
  })
  const serverUsername = await readAnswer("OPENCODE_SERVER_USERNAME", {
    defaultValue: "opencode",
  })
  const serverPassword = await readSecret("OPENCODE_SERVER_PASSWORD", {})
  const opencodeRestartCommand = installOpencode
    ? `launchctl kickstart -k gui/${uid}/${opencodeLabel}`
    : await readAnswer("OPENCODE_RESTART_COMMAND", {})
  const opencodeRestartTimeoutMs = opencodeRestartCommand ? "30000" : ""
  const bridgeRestartCommand = `launchctl kickstart -k gui/${uid}/${bridgeLabel}`

  const { nodePath, cliPath } = resolveExecStart()
  const envValues = {
    TELEGRAM_BOT_TOKEN: botToken,
    ...(allowedUserIds
      ? { TELEGRAM_ALLOWED_USER_IDS: allowedUserIds.join(",") }
      : { TELEGRAM_ALLOWED_USER_ID: allowedUserId ?? "" }),
    OPENCODE_SERVER_URL: serverUrl,
    OPENCODE_SERVER_USERNAME: serverUsername,
    OPENCODE_SERVER_PASSWORD: serverPassword,
    OPENCODE_PROMPT_TIMEOUT_MS: "600000",
    TELEGRAM_HANDLER_TIMEOUT_MS: "630000",
    OPENCODE_RESTART_COMMAND: opencodeRestartCommand,
    OPENCODE_RESTART_TIMEOUT_MS: opencodeRestartTimeoutMs,
    OPENCODE_BRIDGE_RESTART_COMMAND: bridgeRestartCommand,
    OPENCODE_BRIDGE_RESTART_TIMEOUT_MS: "30000",
  }
  writeEnvFile(envPath, envValues)

  const logPath = path.join(
    homeDir,
    "Library",
    "Logs",
    "opencode-telegram-bridge.log",
  )
  const plist = buildLaunchdPlist({
    label: bridgeLabel,
    programArguments: [nodePath, cliPath],
    env: envValues,
    logPath,
  })
  writePlistFile(plistPath, plist)

  if (installOpencode && opencodePath) {
    const nodeDir = path.dirname(nodePath)
    const opencodeLogPath = path.join(
      homeDir,
      "Library",
      "Logs",
      "opencode-server.log",
    )
    const opencodePlist = buildLaunchdPlist({
      label: opencodeLabel,
      programArguments: [opencodePath, "serve"],
      env: {
        PATH: buildLaunchdPath(nodeDir),
      },
      logPath: opencodeLogPath,
    })
    writePlistFile(opencodePlistPath, opencodePlist)
  }

  if (isLaunchdServiceLoaded(uid, bridgeLabel)) {
    runCommand("launchctl", ["bootout", `gui/${uid}`, plistPath])
  }
  runCommand("launchctl", ["bootstrap", `gui/${uid}`, plistPath])
  runCommand("launchctl", ["enable", `gui/${uid}/${bridgeLabel}`])
  runCommand("launchctl", ["kickstart", "-k", `gui/${uid}/${bridgeLabel}`])

  if (installOpencode) {
    if (isLaunchdServiceLoaded(uid, opencodeLabel)) {
      runCommand("launchctl", ["bootout", `gui/${uid}`, opencodePlistPath])
    }
    runCommand("launchctl", ["bootstrap", `gui/${uid}`, opencodePlistPath])
    runCommand("launchctl", ["enable", `gui/${uid}/${opencodeLabel}`])
    runCommand("launchctl", ["kickstart", "-k", `gui/${uid}/${opencodeLabel}`])
  }

  console.log("Setup complete. Service is running.")
  console.log(`Env file: ${envPath}`)
  console.log(`Launch agent: ${plistPath}`)
  console.log("Services start on login. Use a LaunchDaemon for boot-time start.")
}

const runSetupWizard = async () => {
  if (process.platform === "linux") {
    await runSystemdSetup()
    return
  }
  if (process.platform === "darwin") {
    await runLaunchdSetup()
    return
  }
  die("Setup supports Linux systemd and macOS launchd only.")
}

const command = process.argv[2]

if (!command) {
  runBot()
} else if (command === "setup") {
  runSetupWizard().catch((error) => {
    die(error instanceof Error ? error.message : "Setup failed.")
  })
} else {
  die("Unknown command. Use: opencode-telegram-bridge [setup]")
}
