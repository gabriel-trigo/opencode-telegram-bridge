import {
  BridgeError,
  TelegramFileDownloadError,
  TelegramPhotoSelectionError,
} from "./errors.js"

export type TelegramPhotoSize = {
  file_id: string
  width: number
  height: number
  file_size?: number
}

export type TelegramDocument = {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export type DownloadLinkProvider = {
  getFileLink: (fileId: string) => Promise<URL>
}

export type FileAttachment = {
  mime: string
  filename?: string
  dataUrl: string
  byteLength: number
}

export class TelegramImageTooLargeError extends BridgeError {
  override name = "TelegramImageTooLargeError"

  constructor(
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(
      `Image too large (${formatBytes(byteLength)}). Limit is ${formatBytes(maxBytes)}.`,
    )
  }
}

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024

export const DEFAULT_MAX_FILE_BYTES = DEFAULT_MAX_IMAGE_BYTES

export const isImageDocument = (document: TelegramDocument): boolean => {
  const mime = document.mime_type
  if (mime) {
    return mime.startsWith("image/")
  }

  const name = document.file_name
  if (!name) {
    return false
  }

  const lowered = name.toLowerCase()
  return (
    lowered.endsWith(".png") ||
    lowered.endsWith(".jpg") ||
    lowered.endsWith(".jpeg") ||
    lowered.endsWith(".webp")
  )
}

export const isPdfDocument = (document: TelegramDocument): boolean => {
  const mime = document.mime_type
  if (mime) {
    return mime === "application/pdf"
  }

  const name = document.file_name
  if (!name) {
    return false
  }

  return name.toLowerCase().endsWith(".pdf")
}

export const pickLargestPhoto = (photos: TelegramPhotoSize[]): TelegramPhotoSize => {
  if (photos.length === 0) {
    throw new TelegramPhotoSelectionError("Expected at least one photo size")
  }

  const sorted = [...photos].sort((a, b) => {
    const aArea = a.width * a.height
    const bArea = b.width * b.height
    if (aArea !== bArea) {
      return bArea - aArea
    }
    return (b.file_size ?? 0) - (a.file_size ?? 0)
  })
  return sorted[0]!
}

export const buildDataUrl = (mime: string, bytes: Buffer): string => {
  const base64 = bytes.toString("base64")
  return `data:${mime};base64,${base64}`
}

export const downloadTelegramFileAsAttachment = async (
  telegram: DownloadLinkProvider,
  fileId: string,
  options: {
    mime: string
    filename?: string
    maxBytes?: number
    declaredSize?: number
  },
): Promise<FileAttachment> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES
  const declaredSize = options.declaredSize
  if (declaredSize != null && declaredSize > maxBytes) {
    throw new TelegramImageTooLargeError(declaredSize, maxBytes)
  }

  const url = await telegram.getFileLink(fileId)
  const response = await fetch(url)
  if (!response.ok) {
    throw new TelegramFileDownloadError(
      `Failed to download Telegram file (status ${response.status})`,
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const bytes = Buffer.from(arrayBuffer)
  if (bytes.byteLength > maxBytes) {
    throw new TelegramImageTooLargeError(bytes.byteLength, maxBytes)
  }

  return {
    mime: options.mime,
    ...(options.filename ? { filename: options.filename } : {}),
    dataUrl: buildDataUrl(options.mime, bytes),
    byteLength: bytes.byteLength,
  }
}

export const downloadTelegramImageAsAttachment = async (
  telegram: DownloadLinkProvider,
  fileId: string,
  options: {
    mime: string
    filename?: string
    maxBytes?: number
    declaredSize?: number
  },
): Promise<FileAttachment> => downloadTelegramFileAsAttachment(telegram, fileId, options)

const formatBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(1)}MB`
  }

  const kb = bytes / 1024
  if (kb >= 1) {
    return `${kb.toFixed(1)}KB`
  }

  return `${bytes}B`
}
