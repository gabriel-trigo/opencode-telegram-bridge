import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"

export type StoreOptions = {
  dbPath?: string
}

const ensureDatabaseDirectory = (dbPath: string) => {
  const directory = path.dirname(dbPath)
  fs.mkdirSync(directory, { recursive: true })
}

const getDefaultDatabasePath = () =>
  path.join(os.homedir(), ".opencode-telegram-bridge", "projects.db")

const resolveDatabasePath = (options: StoreOptions = {}) =>
  options.dbPath ?? getDefaultDatabasePath()

type DatabaseInstance = ReturnType<typeof Database>

export const createDatabase = (options: StoreOptions = {}): DatabaseInstance => {
  const dbPath = resolveDatabasePath(options)
  ensureDatabaseDirectory(dbPath)
  return new Database(dbPath)
}
