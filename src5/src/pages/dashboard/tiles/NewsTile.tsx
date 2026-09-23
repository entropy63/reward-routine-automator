// The Stock news tile (6.8.0 rewrite): a record whenever a coin amount
// flips between reads — restocks and sell-outs. Owns its hooks. The rows
// are step-invariant; the narrow step (CSS) stacks the "when" chip.

import { useRestockNews, useSoldOutNews } from '../../../popup/hooks/useRedeem.ts'
import { timeAgo } from './shared.tsx'
import { Tile } from './Tile.tsx'
import type { TileProps } from './Tile.tsx'

export function NewsTile({ seat, ...rest }: TileProps) {
  const restockNews = useRestockNews()
  const soldOutNews = useSoldOutNews()

  return (
    <Tile id="news" title="Stock news" seat={seat} {...rest}>
      {restockNews || soldOutNews ? (
        <ul className="news-feed">
          {restockNews && restockNews.labels.length > 0 && (
            <li className="news-row news-row--good">
              <span className="news-when">{timeAgo(restockNews.at)}</span>
              <span>Overwatch coins available: {restockNews.labels.join(', ')}.</span>
            </li>
          )}
          {soldOutNews && soldOutNews.labels.length > 0 && (
            <li className="news-row news-row--warn">
              <span className="news-when">{timeAgo(soldOutNews.at)}</span>
              <span>No longer available: {soldOutNews.labels.join(', ')}.</span>
            </li>
          )}
        </ul>
      ) : (
        <p className="dash-muted">A record appears when an amount flips between reads — none yet.</p>
      )}
    </Tile>
  )
}
