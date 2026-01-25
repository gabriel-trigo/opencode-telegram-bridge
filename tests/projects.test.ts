import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  HOME_PROJECT_ALIAS,
  createProjectStore,
} from "../src/projects.js"

const createTempStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-projects-"))
  const dbPath = path.join(root, "projects.db")
  const store = createProjectStore({ dbPath })
  return { store, root }
}

const removeTempStore = (root: string) => {
  fs.rmSync(root, { recursive: true, force: true })
}

describe("project store", () => {
  it("seeds the home project", () => {
    const { store, root } = createTempStore()
    try {
      const home = store.getProject(HOME_PROJECT_ALIAS)
      expect(home).not.toBeNull()
      expect(home?.path).toBe(os.homedir())
      expect(store.listProjects().some((entry) => entry.alias === "home")).toBe(
        true,
      )
    } finally {
      removeTempStore(root)
    }
  })

  it("adds and removes projects", () => {
    const { store, root } = createTempStore()
    const projectDir = fs.mkdtempSync(path.join(root, "project-"))
    try {
      const added = store.addProject("demo", projectDir)
      expect(added.alias).toBe("demo")
      expect(added.path).toBe(projectDir)

      const fetched = store.getProject("demo")
      expect(fetched?.path).toBe(projectDir)

      store.removeProject("demo")
      expect(store.getProject("demo")).toBeNull()
    } finally {
      removeTempStore(root)
    }
  })

  it("rejects using the home alias", () => {
    const { store, root } = createTempStore()
    const projectDir = fs.mkdtempSync(path.join(root, "project-"))
    try {
      expect(() => store.addProject("home", projectDir)).toThrowError(
        "Cannot add project using reserved alias 'home'",
      )
      expect(() => store.removeProject("home")).toThrowError(
        "Cannot remove the home project",
      )
    } finally {
      removeTempStore(root)
    }
  })

  it("throws when removing unknown aliases", () => {
    const { store, root } = createTempStore()
    try {
      expect(() => store.removeProject("missing")).toThrowError(
        "Project alias 'missing' not found",
      )
    } finally {
      removeTempStore(root)
    }
  })
})
