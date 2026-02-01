import { createDatabase, type StoreOptions } from "./storage.js"
import type { ModelRef, SessionOwner, SessionStore } from "./opencode.js"

export type ChatProjectStore = {
  getActiveAlias: (chatId: number) => string | null
  setActiveAlias: (chatId: number, alias: string) => void
  clearActiveAlias: (chatId: number) => boolean
}

export type ChatModelStore = {
  getModel: (chatId: number, projectDir: string) => ModelRef | null
  setModel: (chatId: number, projectDir: string, model: ModelRef) => void
  clearModel: (chatId: number, projectDir: string) => boolean
  clearAll: () => void
}

export const createChatProjectStore = (
  options: StoreOptions = {},
): ChatProjectStore => {
  const db = createDatabase(options)
  db.exec(
    "CREATE TABLE IF NOT EXISTS chat_projects (chat_id INTEGER PRIMARY KEY, alias TEXT NOT NULL)",
  )

  return {
    getActiveAlias: (chatId) => {
      const row = db
        .prepare("SELECT alias FROM chat_projects WHERE chat_id = ?")
        .get(chatId) as { alias: string } | undefined
      return row?.alias ?? null
    },
    setActiveAlias: (chatId, alias) => {
      db.prepare(
        "INSERT INTO chat_projects (chat_id, alias) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET alias = excluded.alias",
      ).run(chatId, alias)
    },
    clearActiveAlias: (chatId) => {
      const result = db
        .prepare("DELETE FROM chat_projects WHERE chat_id = ?")
        .run(chatId)
      return result.changes > 0
    },
  }
}

export const createPersistentSessionStore = (
  options: StoreOptions = {},
): SessionStore => {
  const db = createDatabase(options)
  db.exec(
    "CREATE TABLE IF NOT EXISTS chat_sessions (chat_id INTEGER NOT NULL, project_dir TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY (chat_id, project_dir))",
  )

  return {
    getSessionId: (chatId, projectDir) => {
      const row = db
        .prepare(
          "SELECT session_id FROM chat_sessions WHERE chat_id = ? AND project_dir = ?",
        )
        .get(chatId, projectDir) as { session_id: string } | undefined
      return row?.session_id
    },
    setSessionId: (chatId, projectDir, sessionId) => {
      db.prepare(
        "INSERT INTO chat_sessions (chat_id, project_dir, session_id) VALUES (?, ?, ?) ON CONFLICT(chat_id, project_dir) DO UPDATE SET session_id = excluded.session_id",
      ).run(chatId, projectDir, sessionId)
    },
    clearSession: (chatId, projectDir) => {
      const result = db
        .prepare(
          "DELETE FROM chat_sessions WHERE chat_id = ? AND project_dir = ?",
        )
        .run(chatId, projectDir)
      return result.changes > 0
    },
    clearAll: () => {
      db.prepare("DELETE FROM chat_sessions").run()
    },
    getSessionOwner: (sessionId) => {
      const row = db
        .prepare(
          "SELECT chat_id, project_dir FROM chat_sessions WHERE session_id = ? LIMIT 1",
        )
        .get(sessionId) as { chat_id: number; project_dir: string } | undefined

      if (!row) {
        return null
      }

      return {
        chatId: row.chat_id,
        projectDir: row.project_dir,
      } satisfies SessionOwner
    },
  }
}

export const createChatModelStore = (
  options: StoreOptions = {},
): ChatModelStore => {
  const db = createDatabase(options)
  db.exec(
    "CREATE TABLE IF NOT EXISTS chat_models (chat_id INTEGER NOT NULL, project_dir TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, PRIMARY KEY (chat_id, project_dir))",
  )

  return {
    getModel: (chatId, projectDir) => {
      const row = db
        .prepare(
          "SELECT provider_id, model_id FROM chat_models WHERE chat_id = ? AND project_dir = ?",
        )
        .get(chatId, projectDir) as
        | { provider_id: string; model_id: string }
        | undefined
      if (!row) {
        return null
      }

      return { providerID: row.provider_id, modelID: row.model_id }
    },
    setModel: (chatId, projectDir, model) => {
      db.prepare(
        "INSERT INTO chat_models (chat_id, project_dir, provider_id, model_id) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, project_dir) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id",
      ).run(chatId, projectDir, model.providerID, model.modelID)
    },
    clearModel: (chatId, projectDir) => {
      const result = db
        .prepare(
          "DELETE FROM chat_models WHERE chat_id = ? AND project_dir = ?",
        )
        .run(chatId, projectDir)
      return result.changes > 0
    },
    clearAll: () => {
      db.prepare("DELETE FROM chat_models").run()
    },
  }
}
