import "dotenv/config"

import { loadConfig } from "./config.js"
import { startBot } from "./bot.js"

const config = loadConfig()
const bot = startBot(config)

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
