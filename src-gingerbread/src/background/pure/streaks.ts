// Parsing the streak values the stats read captures. The Earn page's streak
// cards answer "Day 4 of 7 · 1/1" (the screen-reader day line + the footer's
// today-progress), while the dashboard's progressbar tiles answer a bare
// "1/1". The dashboard's big streak cards render both halves when present;
// this parser makes the two levels explicit so the renderer never guesses.
// Pure on purpose: the tests import it directly.

export interface StreakInfo {
  // The streak's day position: "Day 4 of 7" → day 4, of 7.
  day: number | null
  of: number | null
  // Today's progress within the activity: "1/1" searches done today.
  done: number | null
  total: number | null
}

export function parseStreak(value: string | null | undefined): StreakInfo | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null

  const info: StreakInfo = { day: null, of: null, done: null, total: null }

  const dayM = /day\s+(\d+)\s+of\s+(\d+)/i.exec(text)
  if (dayM) {
    info.day = Number(dayM[1])
    info.of = Number(dayM[2])
  }

  // The progress half only counts as the card's own answer when the pair IS
  // the value (a bare "1/1" tile) or rides a day line ("Day 4 of 7 · 1/1") —
  // prose around the pair ("earned last month: 420/420 pts") is some other
  // card's sentence, not a streak.
  const bareM = /^(\d+)\s*\/\s*(\d+)$/.exec(text)
  if (bareM) {
    info.done = Number(bareM[1])
    info.total = Number(bareM[2])
  } else if (dayM) {
    const progM = /(\d+)\s*\/\s*(\d+)/.exec(text.slice(dayM.index + dayM[0].length))
    if (progM) {
      info.done = Number(progM[1])
      info.total = Number(progM[2])
    }
  }

  if (info.day == null && info.done == null) return null
  return info
}

// The Star bonus tile's star count: the redesigned card answers "3/12"
// (lit cells over the grid), the older card a points string ("1,000 pts").
// The star count is what the tile's grid renders; null means no star signal.
export function parseStarCount(value: string | null | undefined): { lit: number; total: number } | null {
  if (value == null) return null
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(value))
  if (!m) return null
  const lit = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(lit) || !Number.isFinite(total) || total <= 0 || lit > total) return null
  return { lit, total }
}
