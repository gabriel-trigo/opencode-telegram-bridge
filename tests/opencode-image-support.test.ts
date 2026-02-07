import { describe, expect, it, vi } from "vitest"

vi.mock("@opencode-ai/sdk/v2", () => {
  return {
    createOpencodeClient: () => {
      return {
        session: {
          create: vi.fn(async () => ({ data: { id: "session-1" } })),
          prompt: vi.fn(async () => {
            throw new Error("prompt should not be called")
          }),
          abort: vi.fn(async () => ({ data: true })),
        },
        config: {
          get: vi.fn(async () => ({ data: { model: "openai/gpt-4.1" } })),
          providers: vi.fn(async () => ({
            data: {
              providers: [
                {
                  id: "openai",
                  models: {
                    "gpt-4.1": {
                      capabilities: { input: { image: false } },
                    },
                  },
                },
              ],
            },
          })),
        },
        permission: {
          reply: vi.fn(async () => ({ data: true })),
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

import { createOpencodeBridge } from "../src/opencode.js"
import { OpencodeModelCapabilityError } from "../src/errors.js"

describe("opencode image capability checks", () => {
  it("throws a clear error when model does not support image input", async () => {
    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const promise = bridge.promptFromChat(
      123,
      {
        text: "analyze",
        files: [
          {
            mime: "image/png",
            dataUrl: "data:image/png;base64,AA==",
          },
        ],
      },
      "/tmp",
    )

    await expect(promise).rejects.toThrow(OpencodeModelCapabilityError)
    await expect(promise).rejects.toThrow("does not support image input")
  })
})
