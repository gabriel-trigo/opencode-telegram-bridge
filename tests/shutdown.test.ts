import { describe, expect, it } from "vitest"

import type { BotInstance } from "../src/bot.js"
import { flushLogger } from "../src/logger.js"

describe("shutdown graceful", () => {
  it("exports the BotInstance type with a stop method", () => {
    const instance: BotInstance = {
      stop: () => undefined,
    }

    expect(instance.stop).toBeInstanceOf(Function)
  })

  it("flushLogger does not throw", () => {
    expect(() => flushLogger()).not.toThrow()
  })
})
