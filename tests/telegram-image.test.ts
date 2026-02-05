import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_MAX_IMAGE_BYTES,
  TelegramImageTooLargeError,
  buildDataUrl,
  downloadTelegramImageAsAttachment,
  isImageDocument,
  pickLargestPhoto,
} from "../src/telegram-image.js"

describe("telegram-image", () => {
  it("picks the largest photo by area", () => {
    const picked = pickLargestPhoto([
      { file_id: "a", width: 100, height: 100 },
      { file_id: "b", width: 200, height: 150 },
      { file_id: "c", width: 300, height: 50 },
    ])
    expect(picked.file_id).toBe("b")
  })

  it("recognizes image documents by mime type", () => {
    expect(
      isImageDocument({ file_id: "x", mime_type: "image/png", file_name: "a" }),
    ).toBe(true)
    expect(
      isImageDocument({ file_id: "x", mime_type: "application/pdf", file_name: "a" }),
    ).toBe(false)
  })

  it("recognizes image documents by extension when mime is missing", () => {
    expect(isImageDocument({ file_id: "x", file_name: "test.PNG" })).toBe(true)
    expect(isImageDocument({ file_id: "x", file_name: "test.pdf" })).toBe(false)
  })

  it("builds a data url", () => {
    const url = buildDataUrl("image/png", Buffer.from([1, 2, 3]))
    expect(url.startsWith("data:image/png;base64,")).toBe(true)
    expect(url).toContain(Buffer.from([1, 2, 3]).toString("base64"))
  })

  it("rejects declared oversize before downloading", async () => {
    const telegram = {
      getFileLink: vi.fn(async () => new URL("https://example.com/file")),
    }
    await expect(
      downloadTelegramImageAsAttachment(telegram, "file", {
        mime: "image/png",
        declaredSize: DEFAULT_MAX_IMAGE_BYTES + 1,
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      }),
    ).rejects.toBeInstanceOf(TelegramImageTooLargeError)
    expect(telegram.getFileLink).not.toHaveBeenCalled()
  })
})
