import { describe, expect, it, vi } from "vitest"

import { createPromptGuard } from "../src/prompt-guard.js"

describe("prompt guard", () => {
  it("blocks concurrent prompts and releases on finish", () => {
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const controller = guard.tryStart(1, 123, onTimeout)
    expect(controller).not.toBeNull()
    expect(guard.tryStart(1, 124, onTimeout)).toBeNull()

    guard.finish(1)
    expect(guard.tryStart(1, 125, onTimeout)).not.toBeNull()
  })

  it("times out and releases the prompt", () => {
    vi.useFakeTimers()
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const controller = guard.tryStart(1, 123, onTimeout)
    expect(controller?.signal.aborted).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(controller?.signal.aborted).toBe(true)
    expect(guard.isInFlight(1)).toBe(false)

    vi.useRealTimers()
  })

  it("aborts a prompt and releases the lock", () => {
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const controller = guard.tryStart(1, 200, onTimeout)
    expect(controller).not.toBeNull()

    guard.setSessionId(1, controller!, "sess-1")
    const aborted = guard.abort(1)
    expect(aborted).not.toBeNull()
    expect(aborted?.replyToMessageId).toBe(200)
    expect(aborted?.sessionId).toBe("sess-1")
    expect(controller?.signal.aborted).toBe(true)
    expect(guard.isInFlight(1)).toBe(false)

    // Timeout should never fire after an explicit abort.
    expect(onTimeout).toHaveBeenCalledTimes(0)
  })
})
