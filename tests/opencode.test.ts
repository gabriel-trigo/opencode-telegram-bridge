import { describe, expect, it } from "vitest"

import { createSessionStore } from "../src/opencode.js"

describe("session store", () => {
  it("stores sessions per chat and project", () => {
    const store = createSessionStore()

    expect(store.getSessionId(1, "/repo/a")).toBeUndefined()

    store.setSessionId(1, "/repo/a", "session-a")
    store.setSessionId(1, "/repo/b", "session-b")

    expect(store.getSessionId(1, "/repo/a")).toBe("session-a")
    expect(store.getSessionId(1, "/repo/b")).toBe("session-b")
    expect(store.getSessionId(2, "/repo/a")).toBeUndefined()
  })

  it("clears sessions per chat and project", () => {
    const store = createSessionStore()

    store.setSessionId(1, "/repo/a", "session-a")

    expect(store.clearSession(1, "/repo/a")).toBe(true)
    expect(store.getSessionId(1, "/repo/a")).toBeUndefined()
    expect(store.clearSession(1, "/repo/a")).toBe(false)
  })
})
