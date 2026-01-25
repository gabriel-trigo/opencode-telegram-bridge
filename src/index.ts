import "dotenv/config"

import { loadConfig } from "./config.js"
import { startBot } from "./bot.js"
import { createOpencodeBridge } from "./opencode.js"

const config = loadConfig()
const opencode = createOpencodeBridge(config.opencode)
const bot = startBot(config, opencode)

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
