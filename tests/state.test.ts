import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createChatModelStore,
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

describe("chat model store", () => {
  it("persists models by chat and project", () => {
    const { root, dbPath } = createTempDbPath()
    try {
      const storeA = createChatModelStore({ dbPath })
      storeA.setModel(1, "/repo/a", {
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
      })

      const storeB = createChatModelStore({ dbPath })
      expect(storeB.getModel(1, "/repo/a")).toEqual({
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
      })
      expect(storeB.getModel(1, "/repo/b")).toBeNull()
    } finally {
      cleanupTempDbPath(root)
    }
  })

  it("clears stored models", () => {
    const { root, dbPath } = createTempDbPath()
    try {
      const storeA = createChatModelStore({ dbPath })
      storeA.setModel(1, "/repo/a", {
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
      })

      storeA.clearAll()

      const storeB = createChatModelStore({ dbPath })
      expect(storeB.getModel(1, "/repo/a")).toBeNull()
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

  it("clears all sessions", () => {
    const { root, dbPath } = createTempDbPath()
    try {
      const storeA = createPersistentSessionStore({ dbPath })
      storeA.setSessionId(1, "/repo/a", "session-a")
      storeA.setSessionId(2, "/repo/b", "session-b")

      storeA.clearAll()

      const storeB = createPersistentSessionStore({ dbPath })
      expect(storeB.getSessionId(1, "/repo/a")).toBeUndefined()
      expect(storeB.getSessionId(2, "/repo/b")).toBeUndefined()
    } finally {
      cleanupTempDbPath(root)
    }
  })
})
