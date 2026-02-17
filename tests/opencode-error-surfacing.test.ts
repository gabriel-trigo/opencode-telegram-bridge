import { describe, expect, it, vi } from "vitest"

const promptMock: any = vi.fn(async () => ({
  data: {
    parts: [],
    info: {
      providerID: "anthropic",
      modelID: "claude",
      error: {
        name: "APIError",
        data: {
          message: "insufficient credits",
          statusCode: 402,
          isRetryable: false,
        },
      },
    },
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
  it("throws a clear OpencodeRequestError when assistant info includes an APIError", async () => {
    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(123, { text: "hello" }, "/tmp")

    await expect(promise).rejects.toThrow(OpencodeRequestError)
    await expect(promise).rejects.toThrow("insufficient credits")
    await expect(promise).rejects.toThrow("402")
  })

  it("falls back to retry parts when assistant info has no error", async () => {
    promptMock.mockResolvedValueOnce({
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
                message: "rate limited",
                statusCode: 429,
                isRetryable: true,
              },
            },
            time: { created: Date.now() },
          },
        ],
        info: { providerID: "anthropic", modelID: "claude" },
      },
    } as any)

    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(123, { text: "hello" }, "/tmp")

    await expect(promise).rejects.toThrow(OpencodeRequestError)
    await expect(promise).rejects.toThrow("rate limited")
    await expect(promise).rejects.toThrow("429")
  })

  it("fails loudly when OpenCode returns no text and no provider error", async () => {
    promptMock.mockResolvedValueOnce({
      data: {
        parts: [],
        info: { providerID: "openai", modelID: "gpt" },
      },
    } as any)

    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(123, { text: "hello" }, "/tmp")
    await expect(promise).rejects.toThrow(OpencodeRequestError)
    await expect(promise).rejects.toThrow("returned no text output")
  })
})
