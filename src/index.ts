import "dotenv/config"

import { loadConfig } from "./config.js"
import { startBot } from "./bot.js"
import { createOpencodeBridge } from "./opencode.js"
import { createProjectStore } from "./projects.js"
import { createChatProjectStore, createPersistentSessionStore } from "./state.js"

const config = loadConfig()
const sessionStore = createPersistentSessionStore()
const opencode = createOpencodeBridge(config.opencode, { sessionStore })
const projects = createProjectStore()
const chatProjects = createChatProjectStore()
const bot = startBot(config, opencode, projects, chatProjects)

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
