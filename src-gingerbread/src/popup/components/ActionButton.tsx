import type { ReactNode } from 'react'

// A run-action button with a busy spinner and three visual kinds. Disabled while
// its own message is in flight so a double-press can't fire twice.
export function ActionButton({
  children,
  onClick,
  kind = 'ghost',
  busy = false,
  disabled = false,
  title,
  className,
}: {
  children: ReactNode
  onClick: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  busy?: boolean
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      className={`btn btn--${kind}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
    >
      {busy && <span className="spin" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}
