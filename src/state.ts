import { createDatabase, type StoreOptions } from "./storage.js"
import type { SessionStore } from "./opencode.js"

export type ChatProjectStore = {
  getActiveAlias: (chatId: number) => string | null
  setActiveAlias: (chatId: number, alias: string) => void
  clearActiveAlias: (chatId: number) => boolean
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
  }
}
