import { useCallback, useState } from 'react'
import { sendMessage } from '../../shared/messages.ts'
import type { Message, MessageResponse } from '../../shared/messages.ts'

// The popup's one door to the worker, with an in-flight marker so a button can
// show a spinner while its message is outstanding. `busy` holds the type of the
// message currently in flight (or null) — the fire-and-forget worker handlers
// resolve fast, so this is mostly a momentary press affordance, not a long wait.
export function useMessage(): {
  send: (message: Message) => Promise<MessageResponse>
  busy: Message['type'] | null
} {
  const [busy, setBusy] = useState<Message['type'] | null>(null)

  const send = useCallback(async (message: Message): Promise<MessageResponse> => {
    setBusy(message.type)
    try {
      return await sendMessage(message)
    } finally {
      setBusy(null)
    }
  }, [])

  return { send, busy }
}
