import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  createChatModelStore,
  createChatProjectStore,
  createPersistentSessionStore,
} from "../src/state.js"
import { createProjectStore } from "../src/projects.js"

const randomSuffix = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`

const tempRoot = path.join(os.tmpdir(), `opencode-telegram-bridge-bun-smoke-${randomSuffix()}`)
fs.mkdirSync(tempRoot, { recursive: true })

const dbPath = path.join(tempRoot, "projects.db")
const projectDir = path.join(tempRoot, "project")
fs.mkdirSync(projectDir, { recursive: true })

const stores = {
  projects: createProjectStore({ dbPath }),
  chatProjects: createChatProjectStore({ dbPath }),
  chatModels: createChatModelStore({ dbPath }),
  sessions: createPersistentSessionStore({ dbPath }),
}

const chatId = 123

// Project store
const initial = stores.projects.listProjects()
if (!initial.some((entry) => entry.alias === "home")) {
  throw new Error("Expected default 'home' project")
}

stores.projects.addProject("demo", projectDir)
const demo = stores.projects.getProject("demo")
if (!demo || demo.path !== projectDir) {
  throw new Error("Expected to read back added project")
}

// Chat project store
if (stores.chatProjects.getActiveAlias(chatId) !== null) {
  throw new Error("Expected no active project alias by default")
}
stores.chatProjects.setActiveAlias(chatId, "demo")
if (stores.chatProjects.getActiveAlias(chatId) !== "demo") {
  throw new Error("Expected active project alias to round-trip")
}
stores.chatProjects.clearActiveAlias(chatId)

// Chat model store
const model = { providerID: "test", modelID: "fake" }
if (stores.chatModels.getModel(chatId, projectDir) !== null) {
  throw new Error("Expected no model by default")
}
stores.chatModels.setModel(chatId, projectDir, model)
const storedModel = stores.chatModels.getModel(chatId, projectDir)
if (!storedModel || storedModel.providerID !== model.providerID || storedModel.modelID !== model.modelID) {
  throw new Error("Expected model to round-trip")
}
stores.chatModels.clearModel(chatId, projectDir)

// Persistent sessions
const sessionId = "session-abc"
stores.sessions.setSessionId(chatId, projectDir, sessionId)
if (stores.sessions.getSessionId(chatId, projectDir) !== sessionId) {
  throw new Error("Expected session id to round-trip")
}
const owner = stores.sessions.getSessionOwner(sessionId)
if (!owner || owner.chatId !== chatId || owner.projectDir !== projectDir) {
  throw new Error("Expected to find session owner")
}
stores.sessions.clearSession(chatId, projectDir)

fs.rmSync(tempRoot, { recursive: true, force: true })

console.log("bun-smoke: ok")
