import { describe, expect, it, vi } from "vitest"

import { createPromptGuard } from "../src/prompt-guard.js"

describe("prompt guard", () => {
  it("blocks concurrent prompts and releases on finish", () => {
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const controller = guard.tryStart(1, onTimeout)
    expect(controller).not.toBeNull()
    expect(guard.tryStart(1, onTimeout)).toBeNull()

    guard.finish(1)
    expect(guard.tryStart(1, onTimeout)).not.toBeNull()
  })

  it("times out and releases the prompt", () => {
    vi.useFakeTimers()
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const controller = guard.tryStart(1, onTimeout)
    expect(controller?.signal.aborted).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(controller?.signal.aborted).toBe(true)
    expect(guard.isInFlight(1)).toBe(false)

    vi.useRealTimers()
  })
})
