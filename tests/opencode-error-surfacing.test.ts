import { describe, expect, it, vi } from "vitest"

const promptMock = vi.fn(async () => ({
  data: {
    parts: [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "msg-1",
        type: "retry",
        attempt: 1,
        error: {
          name: "APIError",
          data: {
            message: "insufficient credits",
            statusCode: 402,
            isRetryable: false,
          },
        },
        time: { created: Date.now() },
      },
    ],
    info: { providerID: "anthropic", modelID: "claude" },
  },
}))

vi.mock("@opencode-ai/sdk/v2", () => {
  return {
    createOpencodeClient: () => {
      return {
        session: {
          create: vi.fn(async () => ({ data: { id: "session-1" } })),
          prompt: promptMock,
          abort: vi.fn(async () => ({ data: true })),
        },
        config: {
          get: vi.fn(async () => ({ data: { model: "anthropic/claude" } })),
          providers: vi.fn(async () => ({ data: { providers: [] } })),
        },
        permission: {
          reply: vi.fn(async () => ({ data: true })),
        },
        question: {
          reply: vi.fn(async () => ({ data: true })),
          reject: vi.fn(async () => ({ data: true })),
        },
        global: {
          event: vi.fn(async () => ({
            stream: (async function* () {
              return
            })(),
          })),
        },
      }
    },
  }
})

import { OpencodeRequestError } from "../src/errors.js"
import { createOpencodeBridge } from "../src/opencode.js"

describe("opencode error surfacing", () => {
  it("throws a clear OpencodeRequestError when response contains only a retry part", async () => {
    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(123, { text: "hello" }, "/tmp")

    await expect(promise).rejects.toThrow(OpencodeRequestError)
    await expect(promise).rejects.toThrow("insufficient credits")
    await expect(promise).rejects.toThrow("402")
  })

  it("fails loudly when OpenCode returns no text and no provider error", async () => {
    promptMock.mockResolvedValueOnce({
      data: {
        parts: [],
        info: { providerID: "openai", modelID: "gpt" },
      },
    })

    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(123, { text: "hello" }, "/tmp")
    await expect(promise).rejects.toThrow(OpencodeRequestError)
    await expect(promise).rejects.toThrow("returned no text output")
  })
})
