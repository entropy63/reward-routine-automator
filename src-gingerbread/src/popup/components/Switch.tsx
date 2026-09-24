import { motion } from 'framer-motion'
import { spring } from '../fx/motion-presets.ts'

// An accessible on/off switch. The thumb slides via a layout animation — the
// track's justify-content flips on `on`, and framer animates the position
// change — so there is no hard-coded travel distance to keep in sync with CSS.
export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  id?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      id={id}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <motion.span layout transition={spring} className="switch-thumb" />
    </button>
  )
}
