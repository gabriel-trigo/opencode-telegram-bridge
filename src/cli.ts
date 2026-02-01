import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { fileURLToPath } from "node:url"

import { runBot } from "./run.js"

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
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
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
    throw new Error("opencode CLI not found in PATH")
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
    throw new Error(`Missing ${prompt}`)
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
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8")
}

const writeUnitFile = (unitPath: string, content: string) => {
  fs.mkdirSync(path.dirname(unitPath), { recursive: true })
  fs.writeFileSync(unitPath, content, "utf8")
}

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

const runSetupWizard = async () => {
  if (process.platform !== "linux") {
    die("Setup currently supports Linux systemd only. See the docs for manual setup.")
  }

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

  const botToken = await readAnswer("TELEGRAM_BOT_TOKEN", { required: true })
  const allowedUserId = await readAnswer("TELEGRAM_ALLOWED_USER_ID", {
    required: true,
  })
  if (!Number.isInteger(Number(allowedUserId))) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID must be an integer")
  }
  const serverUrl = await readAnswer("OPENCODE_SERVER_URL", {
    defaultValue: "http://127.0.0.1:4096",
  })
  const serverUsername = await readAnswer("OPENCODE_SERVER_USERNAME", {
    defaultValue: "opencode",
  })
  const serverPassword = await readAnswer("OPENCODE_SERVER_PASSWORD", {})
  const opencodeRestartCommand = installOpencode
    ? "systemctl --user restart opencode --no-block"
    : await readAnswer("OPENCODE_RESTART_COMMAND", {})
  const opencodeRestartTimeoutMs = opencodeRestartCommand ? "30000" : ""

  const { nodePath, cliPath } = resolveExecStart()
  writeEnvFile(envPath, {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_ALLOWED_USER_ID: allowedUserId,
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
        "Failed to enable linger. Run: sudo loginctl enable-linger",
      )
    }
  }

  console.log("Setup complete. Service is running.")
  console.log(`Env file: ${envPath}`)
  console.log(`Unit file: ${unitPath}`)
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
