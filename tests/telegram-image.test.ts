import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_MAX_IMAGE_BYTES,
  TelegramImageTooLargeError,
  buildDataUrl,
  downloadTelegramImageAsAttachment,
  downloadTelegramFileAsAttachment,
  isImageDocument,
  isPdfDocument,
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

  it("recognizes pdf documents by mime type", () => {
    expect(
      isPdfDocument({ file_id: "x", mime_type: "application/pdf", file_name: "a" }),
    ).toBe(true)
    expect(
      isPdfDocument({ file_id: "x", mime_type: "image/png", file_name: "a" }),
    ).toBe(false)
  })

  it("recognizes pdf documents by extension when mime is missing", () => {
    expect(isPdfDocument({ file_id: "x", file_name: "test.PDF" })).toBe(true)
    expect(isPdfDocument({ file_id: "x", file_name: "test.png" })).toBe(false)
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

  it("downloads a generic file attachment", async () => {
    const telegram = {
      getFileLink: vi.fn(async () => new URL("https://example.com/file")),
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from([1, 2, 3]),
      status: 200,
    }))
    const originalFetch = globalThis.fetch
    // @ts-expect-error - test override
    globalThis.fetch = fetchMock

    try {
      const attachment = await downloadTelegramFileAsAttachment(telegram, "file", {
        mime: "application/pdf",
        filename: "test.pdf",
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      })

      expect(attachment.mime).toBe("application/pdf")
      expect(attachment.filename).toBe("test.pdf")
      expect(attachment.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true)
      expect(attachment.byteLength).toBe(3)
    } finally {
      // @ts-expect-error - restore
      globalThis.fetch = originalFetch
    }
  })
})
