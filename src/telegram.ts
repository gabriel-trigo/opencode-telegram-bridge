export const TELEGRAM_MESSAGE_LIMIT = 4096

export const splitTelegramMessage = (
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): string[] => {
  if (text.length <= limit) {
    return [text]
  }

  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += limit) {
    chunks.push(text.slice(offset, offset + limit))
  }

  return chunks
}
