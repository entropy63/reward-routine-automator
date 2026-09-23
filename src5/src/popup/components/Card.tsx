import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cardVariants } from '../fx/motion-presets.ts'

// A surface panel with an optional titled header + right-aligned action slot.
// Animates via cardVariants, which propagate from the parent view's staggered
// `enter` — the card needs no animate prop of its own.
export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section className={`card${className ? ` ${className}` : ''}`} variants={cardVariants}>
      {(title || action) && (
        <header className="card-head">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </motion.section>
  )
}
