import { describe, expect, it } from "vitest"

import { splitTelegramMessage } from "../src/telegram.js"

describe("splitTelegramMessage", () => {
  it("returns a single chunk when under limit", () => {
    const text = "hello"
    expect(splitTelegramMessage(text, 10)).toEqual([text])
  })

  it("splits at the limit", () => {
    const text = "a".repeat(10)
    expect(splitTelegramMessage(text, 10)).toEqual([text])
  })

  it("splits into multiple chunks", () => {
    const text = "a".repeat(12)
    expect(splitTelegramMessage(text, 10)).toEqual(["a".repeat(10), "aa"])
  })

  it("preserves the original text when joined", () => {
    const text = "b".repeat(25)
    const chunks = splitTelegramMessage(text, 9)
    expect(chunks.join("")).toBe(text)
    expect(chunks.every((chunk) => chunk.length <= 9)).toBe(true)
  })
})
