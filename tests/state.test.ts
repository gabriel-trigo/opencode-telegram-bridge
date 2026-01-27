import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createChatProjectStore,
  createPersistentSessionStore,
} from "../src/state.js"

const createTempDbPath = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-state-"))
  return { root, dbPath: path.join(root, "projects.db") }
}

const cleanupTempDbPath = (root: string) => {
  fs.rmSync(root, { recursive: true, force: true })
}

describe("chat project store", () => {
  it("persists active project aliases per chat", () => {
    const { root, dbPath } = createTempDbPath()
    try {
      const storeA = createChatProjectStore({ dbPath })
      storeA.setActiveAlias(100, "alpha")

      const storeB = createChatProjectStore({ dbPath })
      expect(storeB.getActiveAlias(100)).toBe("alpha")
      expect(storeB.getActiveAlias(200)).toBeNull()
    } finally {
      cleanupTempDbPath(root)
    }
  })
})

describe("persistent session store", () => {
  it("persists sessions by chat and project", () => {
    const { root, dbPath } = createTempDbPath()
    try {
      const storeA = createPersistentSessionStore({ dbPath })
      storeA.setSessionId(1, "/repo/a", "session-a")

      const storeB = createPersistentSessionStore({ dbPath })
      expect(storeB.getSessionId(1, "/repo/a")).toBe("session-a")
      expect(storeB.getSessionOwner("session-a")).toEqual({
        chatId: 1,
        projectDir: "/repo/a",
      })
      expect(storeB.getSessionId(1, "/repo/b")).toBeUndefined()
    } finally {
      cleanupTempDbPath(root)
    }
  })
})
