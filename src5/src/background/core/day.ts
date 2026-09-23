// The local calendar day as "YYYY-MM-DD". Built from the local date
// components on purpose: date.toISOString().slice(0, 10) would give the UTC
// day, which flips at the wrong hour for any non-UTC timezone. Here the day
// starts at local midnight; 11:59pm is simply "not yet tomorrow". Kept pure
// (no storage access) so tests can pass any Date in — and so the pure/ modules
// that import it stay type-strippable under `node --test`.
export function localDayKey(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
