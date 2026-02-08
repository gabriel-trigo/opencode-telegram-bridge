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
import {
  TelegramFileDownloadError,
  TelegramFileDownloadTimeoutError,
  TelegramPhotoSelectionError,
} from "../src/errors.js"

describe("telegram-image", () => {
  it("picks the largest photo by area", () => {
    const picked = pickLargestPhoto([
      { file_id: "a", width: 100, height: 100 },
      { file_id: "b", width: 200, height: 150 },
      { file_id: "c", width: 300, height: 50 },
    ])
    expect(picked.file_id).toBe("b")
  })

  it("throws when no photos are provided", () => {
    expect(() => pickLargestPhoto([])).toThrowError(TelegramPhotoSelectionError)
    expect(() => pickLargestPhoto([])).toThrowError(
      "Expected at least one photo size",
    )
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
    globalThis.fetch = fetchMock as any

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
      globalThis.fetch = originalFetch
    }
  })

  it("throws when telegram download fails", async () => {
    const telegram = {
      getFileLink: vi.fn(async () => new URL("https://example.com/file")),
    }
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => Buffer.from([]),
    }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any

    try {
      await expect(
        downloadTelegramFileAsAttachment(telegram, "file", {
          mime: "application/pdf",
          filename: "test.pdf",
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
        }),
      ).rejects.toBeInstanceOf(TelegramFileDownloadError)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("times out when download takes too long", async () => {
    vi.useFakeTimers()

    const telegram = {
      getFileLink: vi.fn(async () => new URL("https://example.com/file")),
    }

    const fetchMock = vi.fn(async (_url: any, init?: any) => {
      const signal = init?.signal as AbortSignal | undefined
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted") as Error & { name: string }
            error.name = "AbortError"
            reject(error)
          },
          { once: true },
        )
      })
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as any

    try {
      const promise = downloadTelegramFileAsAttachment(telegram, "file", {
        mime: "application/pdf",
        filename: "test.pdf",
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
        timeoutMs: 30,
      })

      const expectation = expect(promise).rejects.toBeInstanceOf(
        TelegramFileDownloadTimeoutError,
      )

      await vi.advanceTimersByTimeAsync(30)

      await expectation
    } finally {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    }
  })
})
