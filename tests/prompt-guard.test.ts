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
    expect(onTimeout).toHaveBeenCalledWith({
      replyToMessageId: 123,
      sessionId: null,
    })
    expect(controller?.signal.aborted).toBe(true)
    expect(guard.isInFlight(1)).toBe(false)

    vi.useRealTimers()
  })

  it("cancels all in-flight prompts with cancelAll", () => {
    const guard = createPromptGuard(1000)
    const onTimeout = vi.fn()

    const c1 = guard.tryStart(1, 100, onTimeout)
    const c2 = guard.tryStart(2, 200, onTimeout)
    expect(c1).not.toBeNull()
    expect(c2).not.toBeNull()

    guard.cancelAll()

    expect(c1?.signal.aborted).toBe(true)
    expect(c2?.signal.aborted).toBe(true)
    expect(guard.isInFlight(1)).toBe(false)
    expect(guard.isInFlight(2)).toBe(false)
    expect(onTimeout).toHaveBeenCalledTimes(0)
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
