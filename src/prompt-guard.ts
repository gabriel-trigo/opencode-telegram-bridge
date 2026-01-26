export type PromptGuard = {
  tryStart: (chatId: number, onTimeout: () => void) => AbortController | null
  finish: (chatId: number) => void
  isInFlight: (chatId: number) => boolean
}

export const createPromptGuard = (timeoutMs: number): PromptGuard => {
  const inFlight = new Map<
    number,
    { abortController: AbortController; timeoutId: NodeJS.Timeout }
  >()

  const tryStart = (chatId: number, onTimeout: () => void) => {
    /*
     * This function is synchronous. It schedules a timeout and returns
     * immediately with an AbortController. The timeout callback will run
     * later on the event loop if it is not cleared first.
     */
    if (inFlight.has(chatId)) {
      return null
    }

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      /*
       * Only fire the timeout if this prompt is still the active one for
       * the chat. If it already finished or was replaced, do nothing.
       */
      const entry = inFlight.get(chatId)
      if (!entry || entry.abortController !== abortController) {
        return
      }

      inFlight.delete(chatId)
      abortController.abort()
      onTimeout()
    }, timeoutMs)

    inFlight.set(chatId, { abortController, timeoutId })
    return abortController
  }

  const finish = (chatId: number) => {
    /*
     * Clearing the timeout cancels the scheduled callback so it never runs.
     * This prevents late timeout handling after a prompt already finished.
     */
    const entry = inFlight.get(chatId)
    if (!entry) {
      return
    }

    clearTimeout(entry.timeoutId)
    inFlight.delete(chatId)
  }

  return {
    tryStart,
    finish,
    isInFlight: (chatId) => inFlight.has(chatId),
  }
}
