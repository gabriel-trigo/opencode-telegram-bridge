import "dotenv/config"

import { loadConfig } from "./config.js"
import { startBot } from "./bot.js"
import { createOpencodeBridge } from "./opencode.js"
import { createProjectStore } from "./projects.js"

const config = loadConfig()
const opencode = createOpencodeBridge(config.opencode)
const projects = createProjectStore()
const bot = startBot(config, opencode, projects)

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
