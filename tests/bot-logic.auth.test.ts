import { describe, expect, it } from "vitest"

import { formatUserLabel, isAuthorized } from "../src/bot-logic.js"

describe("isAuthorized", () => {
  it("authorizes only the allowed user id", () => {
    expect(isAuthorized({ id: 10 }, 10)).toBe(true)
    expect(isAuthorized({ id: 11 }, 10)).toBe(false)
    expect(isAuthorized(undefined, 10)).toBe(false)
    expect(isAuthorized({ username: "no-id" }, 10)).toBe(false)
  })
})

describe("formatUserLabel", () => {
  it("formats known and unknown users", () => {
    expect(formatUserLabel(undefined)).toBe("unknown")
    expect(formatUserLabel({})).toBe("unknown")
    expect(formatUserLabel({ id: 42 })).toBe("42")
    expect(formatUserLabel({ username: "alice", id: 1 })).toBe("alice (1)")
    expect(formatUserLabel({ username: "alice" })).toBe("alice (unknown)")
  })
})
