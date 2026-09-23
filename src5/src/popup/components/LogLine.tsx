import type { ImageSearchRow, LogRow } from '../../shared/storage.ts'

function toneClass(ok: boolean | null | undefined): string {
  if (ok === true) return 'ok'
  if (ok === false) return 'bad'
  return 'neutral'
}

// One subsystem's log row: a label and its last detail line, with an optional
// tone dot — the popup's Activity view shows the dot (ok/bad/neutral), the
// dashboard's log tile omits it. A row with no detail renders nothing; a raw
// capture (`dump`) rides in the title tooltip when one is present.
export function LogLine({
  label,
  row,
  dot = false,
}: {
  label: string
  row: LogRow | ImageSearchRow | null
  dot?: boolean
}) {
  if (!row || !row.detail) return null
  return (
    <li className="log-row" title={('dump' in row && row.dump) || undefined}>
      {dot && <span className={`log-dot ${toneClass(row.ok)}`} />}
      <div className="log-body">
        <span className="log-label">{label}</span>
        {row.ok === false && <span className="log-failure">Failed</span>}
        <span className="log-detail">{row.detail}</span>
      </div>
    </li>
  )
}
