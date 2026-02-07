import { describe, expect, it, vi } from "vitest"

const promptMock = vi.fn(async () => ({
  data: {
    parts: [{ type: "text", text: "ok" }],
    info: { providerID: "openai", modelID: "gpt-4.1" },
  },
}))

const providersMock = vi.fn(async () => ({
  data: {
    providers: [
      {
        id: "openai",
        models: {
          "gpt-4.1": {
            capabilities: { input: { image: true } },
            modalities: {
              input: ["text", "image", "pdf"],
              output: ["text"],
            },
          },
        },
      },
    ],
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
          get: vi.fn(async () => ({ data: { model: "openai/gpt-4.1" } })),
          providers: providersMock,
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
import { OpencodeModelModalitiesError } from "../src/errors.js"

describe("opencode pdf capability checks", () => {
  it("allows a pdf file when model exposes pdf modality", async () => {
    const bridge = createOpencodeBridge({
      serverUrl: "http://localhost:3000",
      serverUsername: "opencode",
    })

    const result = await bridge.promptFromChat(
      123,
      {
        text: "analyze",
        files: [
          {
            mime: "application/pdf",
            filename: "test.pdf",
            dataUrl: "data:application/pdf;base64,AA==",
          },
        ],
      },
      "/tmp",
    )

    expect(result.reply).toBe("ok")
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("fails loudly when model does not expose modalities", async () => {
    providersMock.mockResolvedValueOnce({
      data: {
        providers: [
          {
            id: "openai",
            models: {
              "gpt-4.1": {
                capabilities: { input: { image: true } },
              },
            },
          },
        ],
      },
    })

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
            mime: "application/pdf",
            filename: "test.pdf",
            dataUrl: "data:application/pdf;base64,AA==",
          },
        ],
      },
      "/tmp",
    )

    await expect(promise).rejects.toThrow(OpencodeModelModalitiesError)
    await expect(promise).rejects.toThrow(
      "Model does not expose modalities, can't check for PDF support",
    )
  })
})
