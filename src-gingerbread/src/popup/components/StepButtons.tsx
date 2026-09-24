import { ActionButton } from './ActionButton.tsx'
import type { Message, MessageResponse } from '../../shared/messages.ts'

// The four "run one step" actions, wired to the live engine. Shared by the
// popup's Run view and the dashboard's Run-controls tile so the two surfaces
// can never drift on which steps exist or what a press sends.
export function StepButtons({
  send,
  busy,
}: {
  send: (message: Message) => Promise<MessageResponse>
  busy: Message['type'] | null
}) {
  return (
    <div className="action-grid">
      <ActionButton onClick={() => send({ type: 'RUN_DAILY_SET' })} busy={busy === 'RUN_DAILY_SET'}>Daily set</ActionButton>
      <ActionButton onClick={() => send({ type: 'RUN_KEEP_EARNING' })} busy={busy === 'RUN_KEEP_EARNING'}>Keep earning</ActionButton>
      <ActionButton onClick={() => send({ type: 'RUN_IMAGE_SEARCH' })} busy={busy === 'RUN_IMAGE_SEARCH'}>Image search</ActionButton>
      <ActionButton onClick={() => send({ type: 'RUN_CLAIM' })} busy={busy === 'RUN_CLAIM'}>Claim points</ActionButton>
    </div>
  )
}
