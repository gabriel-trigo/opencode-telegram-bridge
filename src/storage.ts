import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type StoreOptions = {
  dbPath?: string
}

type StatementResult = {
  changes: number
}

type Statement = {
  run: (...params: unknown[]) => StatementResult
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
}

export type DatabaseInstance = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

const ensureDatabaseDirectory = (dbPath: string) => {
  const directory = path.dirname(dbPath)
  fs.mkdirSync(directory, { recursive: true })
}

const getDefaultDatabasePath = () =>
  path.join(os.homedir(), ".opencode-telegram-bridge", "projects.db")

const resolveDatabasePath = (options: StoreOptions = {}) =>
  options.dbPath ?? getDefaultDatabasePath()

const isBunRuntime = () => typeof (process.versions as { bun?: string }).bun === "string"

const callWithParams = <T>(fn: (...args: unknown[]) => T, params: unknown[]): T => {
  if (params.length === 0) {
    return fn()
  }
  if (params.length === 1) {
    return fn(params[0])
  }
  // bun:sqlite prefers passing params as an array for positional bindings.
  return fn(params)
}

const coerceChanges = (value: unknown): number => {
  if (!value || typeof value !== "object") {
    return 0
  }
  const changes = (value as { changes?: unknown }).changes
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0
}

let sqliteFactory: ((dbPath: string) => DatabaseInstance) | null = null

const loadSqliteFactory = async (): Promise<((dbPath: string) => DatabaseInstance)> => {
  if (sqliteFactory) {
    return sqliteFactory
  }

  if (isBunRuntime()) {
    const mod = await import("bun:sqlite")
    const BunDatabase = (mod as unknown as { Database: new (path: string) => unknown }).Database

    sqliteFactory = (dbPath: string) => {
      const db = new BunDatabase(dbPath) as {
        exec: (sql: string) => void
        query: (sql: string) => {
          run: (...args: unknown[]) => unknown
          get: (...args: unknown[]) => unknown
          all: (...args: unknown[]) => unknown[]
        }
      }

      return {
        exec: (sql) => db.exec(sql),
        prepare: (sql) => {
          const stmt = db.query(sql)
          const boundRun = (...args: unknown[]) => stmt.run(...args)
          const boundGet = (...args: unknown[]) => stmt.get(...args)
          const boundAll = (...args: unknown[]) => stmt.all(...args)
          return {
            run: (...params) => {
              const result = callWithParams(boundRun, params)
              return { changes: coerceChanges(result) }
            },
            get: (...params) => callWithParams(boundGet, params),
            all: (...params) => callWithParams(boundAll, params),
          }
        },
      }
    }

    return sqliteFactory
  }

  const mod = await import("better-sqlite3")
  const BetterSqlite3 = (mod as unknown as { default: new (path: string) => unknown }).default

  sqliteFactory = (dbPath: string) => {
    const db = new BetterSqlite3(dbPath) as unknown as DatabaseInstance
    return db
  }

  return sqliteFactory
}

const factoryPromise = loadSqliteFactory()

export const createDatabase = (options: StoreOptions = {}): DatabaseInstance => {
  const dbPath = resolveDatabasePath(options)
  ensureDatabaseDirectory(dbPath)

  if (!sqliteFactory) {
    throw new Error(
      "SQLite backend not initialized yet. This should never happen (module initialization race).",
    )
  }

  return sqliteFactory(dbPath)
}

// Ensure the factory is initialized during module load.
// This keeps the rest of the codebase synchronous.
await factoryPromise
