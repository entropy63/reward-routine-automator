import { useEffect, useRef } from 'react'

// The constellation grid: nodes drifting slowly, joined by faint lines to
// their near neighbors — and to the pointer, which lights up the web around
// it as it moves. The one backdrop style drawn on a canvas (hundreds of line
// segments per frame is exactly what canvas is for). Node and link colors
// follow the theme's accent, read once at mount. When motion is off it draws
// a single still frame — the web without the drift.
export function ConstellationBackground({ animate }: { animate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const LINK = 96 // node-to-node link radius (css px)
    const MOUSE_LINK = 150 // node-to-pointer link radius
    let w = 0
    let h = 0
    let raf = 0
    const mouse = { x: -9999, y: -9999 }

    type Node = { x: number; y: number; vx: number; vy: number }
    let nodes: Node[] = []

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#06b6d4'

    // Our accents are #rrggbb; parse once so per-frame alpha is cheap.
    let rgb = ''
    if (accent.length === 7) {
      rgb = `${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)}`
    }
    const tint = (a: number): string => (rgb ? `rgba(${rgb},${a})` : accent)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Density scales with area so the popup and the full pages feel alike.
      const count = Math.max(14, Math.round((w * h) / 8500))
      while (nodes.length < count) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.24,
          vy: (Math.random() - 0.5) * 0.24,
        })
      }
      nodes = nodes.slice(0, count)
    }

    const draw = (advance: boolean) => {
      ctx.clearRect(0, 0, w, h)
      if (advance) {
        for (const n of nodes) {
          n.x += n.vx
          n.y += n.vy
          if (n.x < -12) n.x = w + 12
          else if (n.x > w + 12) n.x = -12
          if (n.y < -12) n.y = h + 12
          else if (n.y > h + 12) n.y = -12
        }
      }

      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          if (Math.abs(dx) > LINK || Math.abs(dy) > LINK) continue
          const d = Math.hypot(dx, dy)
          if (d < LINK) {
            ctx.strokeStyle = tint(0.15 * (1 - d / LINK))
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
        // The pointer joins the constellation: brighter links to nearby nodes.
        const dxm = a.x - mouse.x
        const dym = a.y - mouse.y
        if (Math.abs(dxm) < MOUSE_LINK && Math.abs(dym) < MOUSE_LINK) {
          const dm = Math.hypot(dxm, dym)
          if (dm < MOUSE_LINK) {
            ctx.strokeStyle = tint(0.45 * (1 - dm / MOUSE_LINK))
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(mouse.x, mouse.y)
            ctx.stroke()
          }
        }
      }

      ctx.fillStyle = tint(0.5)
      for (const n of nodes) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }

    const onResize = () => {
      resize()
      draw(false)
    }

    resize()
    if (animate) {
      const loop = () => {
        draw(true)
        raf = requestAnimationFrame(loop)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('resize', onResize)
      raf = requestAnimationFrame(loop)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('resize', onResize)
        cancelAnimationFrame(raf)
      }
    }
    draw(false)
    return () => {}
  }, [animate])

  return (
    <div className="bg bg--constellation" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}
