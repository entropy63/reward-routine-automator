import { useEffect } from 'react'

// The troll (user request, 2026-09-07): with this on, EVERYTHING in the popup
// dodges the cursor — buttons, links, inputs, icons, text, chips, plan rows,
// the works, in every tab including Settings — and the cards themselves drift
// a little, carrying their fleeing contents with them. Only three things are
// sacred, marked [data-no-escape]: the gear that opens Settings (the way in),
// the Back button (the way out), and the troll's own row in Settings (or it
// could never be turned off). The backdrop is likewise off the team — it has
// its own pointer reactions.
//
// The drag-reorder rows used to be sacred too; since 2026-09-11 they dodge
// like everything else (user: "the items that should escape the mouse
// including items that can be ordered in the setting"). Two markers make that
// safe against framer-motion, whose Reorder.Item OWNS the transform property
// while a drag animates the list:
//   [data-escape-unit] — the element flees as ONE unit (a reorder row is not
//              a button and has children, so nothing would otherwise mark it
//              an atom and its handle/label/switch would peel apart).
//   [data-escape-hold] — a subtree that is hands-off while set: during an
//              active reorder drag the pointer is pressed on one row and
//              framer is transform-animating the others, so the troll drops
//              whatever offset it had there and neither reads nor writes
//              until the hold lifts (two writers on one transform = jitter).
//
// Scope, collected after every DOM change:
//   atoms    — interactive elements (button/a/select/input/role=…), svgs, and
//              any childless element (text spans, chip values, plan dots):
//              the OUTERMOST atom in a chain participates, so a button flees
//              as one unit with its icon and label, not as loose parts.
//   cards    — .card elements drift gently alongside their (fully fleeing)
//              contents: a smaller radius, a much shorter leash.
//
// Implementation: one window-level mousemove listener + one rAF loop writing
// transforms directly (the same imperative approach as the interactive
// backdrops — per-element framer subscriptions would be one subscription per
// control). Each frame, a participant whose rect sits within its tier's
// RADIUS of the pointer is pushed further away along pointer → element,
// carrying the offset it has already traveled — and it STAYS out: a
// stationary pointer freezes everything in place (no returning, no tremor —
// a hysteresis band around the radius means the flee/settle boundary can't
// oscillate), and an element only eases home once the pointer actually moves
// away beyond the band. Leaving the document drops the pointer outright, so
// a cursor outside the popup holds nothing displaced. Rects are read in one
// pass before any write, so the frame costs a single layout instead of a
// read/write sandwich per element.
const TIERS = {
  // Small controls and text: a real getaway.
  atom: { radius: 70, max: 110, ease: 0.22 },
  // Cards: a nervous shuffle, nothing more — they still have to read as tiles.
  card: { radius: 46, max: 14, ease: 0.1 },
} as const
type Tier = keyof typeof TIERS

export function useMouseEscape(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    // Resolved lazily, not at effect time: App withholds its DOM until the
    // stored settings arrive, so .app may not exist yet when this runs.
    let app: HTMLElement | null = null

    let escapables: HTMLElement[] = []
    const offsets = new Map<HTMLElement, { x: number; y: number }>()
    let pointer: { x: number; y: number } | null = null
    let dirty = true
    let raf = 0

    function isAtom(el: HTMLElement): boolean {
      return (
        el.matches('button, a, select, input, [role="button"], [role="switch"], [data-escape-unit]') ||
        el.tagName.toLowerCase() === 'svg' ||
        el.children.length === 0
      )
    }

    function collect(app: HTMLElement): void {
      const inApp = Array.from(app.querySelectorAll<HTMLElement>('*')).filter(
        (el) =>
          // Sacred ground: the gear, the Back button, the troll's own row —
          // and everything behind the backdrop's own pointer effects.
          !el.closest('[data-no-escape]') &&
          !el.closest('.bg') &&
          !el.matches('canvas'),
      )
      const atoms = inApp.filter(isAtom)
      const atomSet = new Set(atoms)
      // The outermost atom in a chain carries the rest: a button flees whole,
      // its svg/label children riding along instead of peeling off.
      escapables = atoms.filter((el) => {
        for (let p = el.parentElement; p && p !== app; p = p.parentElement) {
          if (atomSet.has(p)) return false
        }
        return true
      })
      // Cards drift too — on top of, not instead of, their fleeing contents.
      for (const el of inApp) {
        if (el.classList.contains('card')) escapables.push(el)
      }
      // Drop offsets for elements that left the DOM (view swap), keep the
      // ones that survived so they resume their dodge instead of teleporting.
      const live = new Set(escapables)
      for (const el of offsets.keys()) {
        if (!live.has(el)) offsets.delete(el)
      }
    }

    function frame(): void {
      if (!app) app = document.querySelector<HTMLElement>('.app')
      if (app && dirty) {
        dirty = false
        collect(app)
      }
      if (!app) {
        raf = requestAnimationFrame(frame)
        return
      }

      // Read pass: every rect first (one layout), targets computed from them.
      // Within the radius → keep fleeing; in the hysteresis band just outside
      // it → HOLD (a parked pointer leaves an escaped element escaped); far
      // beyond it → home. A still pointer produces identical targets every
      // frame, so nothing moves.
      //
      // [data-escape-hold] subtrees are hands-off (a Reorder list mid-drag —
      // framer owns the transform while the drag animates the list): whatever
      // offset the troll had there is dropped ONCE, and the element is
      // neither read nor written until the hold lifts. Two writers on one
      // transform is a 60fps jitter, so the hold is checked every frame, not
      // at collect time.
      const holds = document.querySelectorAll('[data-escape-hold]')
      let heldCheck: ((el: HTMLElement) => boolean) | null = null
      if (holds.length) {
        heldCheck = (el: HTMLElement): boolean => {
          for (const h of holds) {
            if (h.contains(el)) return true
          }
          return false
        }
        for (const el of escapables) {
          if (heldCheck(el) && offsets.has(el)) {
            offsets.delete(el)
            el.style.transform = ''
          }
        }
      }
      const targets: { el: HTMLElement; tier: Tier; off: { x: number; y: number }; tx: number; ty: number }[] = []
      if (pointer) {
        for (const el of escapables) {
          if (heldCheck && heldCheck(el)) continue
          const tier: Tier = el.classList.contains('card') ? 'card' : 'atom'
          const off = offsets.get(el) || { x: 0, y: 0 }
          const { radius, max } = TIERS[tier]
          const rect = el.getBoundingClientRect()
          // The gap between the pointer and the element's current rect.
          const nx = Math.max(rect.left, Math.min(pointer.x, rect.right))
          const ny = Math.max(rect.top, Math.min(pointer.y, rect.bottom))
          const gap = Math.hypot(pointer.x - nx, pointer.y - ny)
          let tx = 0
          let ty = 0
          if (gap < radius) {
            // Flee along pointer → current center, carrying the offset
            // already traveled. If the pointer parks dead on the element,
            // the direction is undefined — fall back to a stable per-position
            // angle so it still escapes instead of sitting under the cursor.
            const ccx = rect.left + rect.width / 2
            const ccy = rect.top + rect.height / 2
            let dx = ccx - pointer.x
            let dy = ccy - pointer.y
            const len = Math.hypot(dx, dy)
            if (len < 1) {
              const angle = ((((ccx * 13 + ccy * 7) % 360) + 360) % 360) * (Math.PI / 180)
              dx = Math.cos(angle)
              dy = Math.sin(angle)
            } else {
              dx /= len
              dy /= len
            }
            const push = radius - gap + 8 // slight overshoot so it clears
            tx = off.x + dx * push
            ty = off.y + dy * push
            // Keep the trip bounded — .app clips at its edges anyway.
            const tlen = Math.hypot(tx, ty)
            if (tlen > max) {
              tx = (tx / tlen) * max
              ty = (ty / tlen) * max
            }
          } else if (gap < radius + 14) {
            // Hysteresis band: just cleared the radius — hold this position
            // instead of flipping to home, so the boundary can't tremble.
            tx = off.x
            ty = off.y
          }
          targets.push({ el, tier, off, tx, ty })
        }
      }

      // Write pass: ease toward the target. When the pointer hasn't moved yet
      // (targets empty), only displaced elements need easing back home.
      const writes = targets.length
        ? targets
        : escapables
            .filter((el) => offsets.has(el))
            .map((el) => ({
              el,
              tier: (el.classList.contains('card') ? 'card' : 'atom') as Tier,
              off: offsets.get(el) || { x: 0, y: 0 },
              tx: 0,
              ty: 0,
            }))
      for (const { el, tier, off, tx, ty } of writes) {
        const { ease } = TIERS[tier]
        off.x += (tx - off.x) * ease
        off.y += (ty - off.y) * ease
        const moving = Math.abs(off.x) > 0.5 || Math.abs(off.y) > 0.5
        if (moving) {
          offsets.set(el, off)
          el.style.transform = `translate(${off.x}px, ${off.y}px)`
        } else if (offsets.has(el)) {
          offsets.delete(el)
          el.style.transform = ''
        }
      }

      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: MouseEvent): void => {
      pointer = { x: e.clientX, y: e.clientY }
    }

    // A cursor that left the popup holds nothing: drop the pointer so
    // everything homes immediately instead of staying fled from its last
    // position.
    const onLeave = (): void => {
      pointer = null
    }

    // Re-collect when the stage swaps views (the subtree is replaced) — and
    // when .app first appears, if this effect beat App's render gate. Only
    // childList is observed on <body>: attributes would fire on our own style
    // writes, and .app's insides are all it needs to see.
    const observer = new MutationObserver(() => {
      dirty = true
    })
    observer.observe(document.body, { childList: true, subtree: true })

    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      observer.disconnect()
      // Everything back to where it belongs.
      for (const el of offsets.keys()) el.style.transform = ''
      offsets.clear()
    }
  }, [enabled])
}
