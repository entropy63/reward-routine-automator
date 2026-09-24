// The Activity log tile (6.8.0 rewrite): the last line of every engine
// subsystem, scrolling inside the tile (no scrollbar chrome). Reads the shared
// activity log (the same set the popup's Activity view shows). The list itself
// is step-invariant — a taller step just shows more rows; the narrow step
// (CSS) drops the label column.

import { LogLine } from '../../../popup/components/LogLine.tsx'
import { useActivityLog } from '../../../popup/hooks/useActivityLog.ts'
import { Tile } from './Tile.tsx'
import type { TileProps } from './Tile.tsx'

export function LogTile({ seat, ...rest }: TileProps) {
  const { tabAction, rewards, statsLog, redeemLog, ordersLog, imageLog, lastQuery, hasLogs } = useActivityLog()

  return (
    <Tile id="log" title="Activity log" seat={seat} {...rest}>
      <ul className="log">
        {lastQuery?.text && (
          <li className="log-row">
            <div className="log-body">
              <span className="log-label">Last query</span>
              <span className="log-detail">
                {lastQuery.text}
                {lastQuery.api ? ` · ${lastQuery.api}` : ''}
              </span>
            </div>
          </li>
        )}
        <LogLine label="Tabs" row={tabAction} />
        <LogLine label="Rewards" row={rewards} />
        <LogLine label="Stats" row={statsLog} />
        <LogLine label="Redeem" row={redeemLog} />
        <LogLine label="Orders" row={ordersLog} />
        <LogLine label="Image search" row={imageLog} />
      </ul>
      {!hasLogs && <p className="dash-muted">Nothing yet — run a step or the routine to fill this in.</p>}
    </Tile>
  )
}
