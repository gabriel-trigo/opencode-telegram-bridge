import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { createDatabase, type StoreOptions } from "./storage.js"

export type ProjectRecord = {
  alias: string
  path: string
}

export type ProjectStore = {
  listProjects: () => ProjectRecord[]
  getProject: (alias: string) => ProjectRecord | null
  addProject: (alias: string, projectPath: string) => ProjectRecord
  removeProject: (alias: string) => void
}

export const HOME_PROJECT_ALIAS = "home"

const normalizeAlias = (alias: string) => {
  const trimmed = alias.trim()
  if (!trimmed) {
    throw new Error("Project alias is required")
  }

  return trimmed
}

const expandHomePath = (rawPath: string) => {
  if (rawPath === "~") {
    return os.homedir()
  }

  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2))
  }

  return rawPath
}

const resolveProjectPath = (rawPath: string) => {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw new Error("Project path is required")
  }

  const expanded = expandHomePath(trimmed)
  const resolved = path.resolve(expanded)
  const stats = fs.statSync(resolved)
  if (!stats.isDirectory()) {
    throw new Error("Project path must be a directory")
  }

  return resolved
}

export const createProjectStore = (
  options: StoreOptions = {},
): ProjectStore => {
  const db = createDatabase(options)
  db.exec(
    "CREATE TABLE IF NOT EXISTS projects (alias TEXT PRIMARY KEY, path TEXT NOT NULL)",
  )

  const homePath = os.homedir()
  db.prepare(
    "INSERT INTO projects (alias, path) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET path = excluded.path",
  ).run(HOME_PROJECT_ALIAS, homePath)

  return {
    listProjects: () =>
      db
        .prepare(
          "SELECT alias, path FROM projects ORDER BY CASE WHEN alias = ? THEN 0 ELSE 1 END, alias",
        )
        .all(HOME_PROJECT_ALIAS) as ProjectRecord[],
    getProject: (alias: string) => {
      const normalized = normalizeAlias(alias)
      const row = db
        .prepare("SELECT alias, path FROM projects WHERE alias = ?")
        .get(normalized) as ProjectRecord | undefined
      return row ?? null
    },
    addProject: (alias: string, projectPath: string) => {
      const normalized = normalizeAlias(alias)
      if (normalized === HOME_PROJECT_ALIAS) {
        throw new Error("Cannot add project using reserved alias 'home'")
      }

      const resolved = resolveProjectPath(projectPath)
      db.prepare("INSERT INTO projects (alias, path) VALUES (?, ?)").run(
        normalized,
        resolved,
      )
      return { alias: normalized, path: resolved }
    },
    removeProject: (alias: string) => {
      const normalized = normalizeAlias(alias)
      if (normalized === HOME_PROJECT_ALIAS) {
        throw new Error("Cannot remove the home project")
      }

      const result = db
        .prepare("DELETE FROM projects WHERE alias = ?")
        .run(normalized)
      if (result.changes === 0) {
        throw new Error(`Project alias '${normalized}' not found`)
      }
    },
  }
}
