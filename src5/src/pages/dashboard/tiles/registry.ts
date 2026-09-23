// The dashboard's tile registry (6.8.0 rewrite, user request 2026-09-11:
// "I do not like the current layout… start again from scratch… correct them
// from 'crushed' to 'optimized'… Maybe put some default sizes. For tiles and
// dynamic tiles") — PURE DATA, no JSX (the node --test suites import it
// directly; the component map that pairs ids with tile components lives in
// layout/GridLayout.tsx).
//
// Every tile declares the sizes it was DESIGNED for — a list of steps, small
// to large. The resize grip snaps to those steps and nothing between them
// (layout/snap.ts), so a tile is never CSS-squeezed below a layout it was
// designed for: every reachable size is a designed size, and each one has a
// content variant built for it (the step INDEX picks the variant). That is
// the whole "crushed → optimized" fix.
//
// Units: w is a span over the board's 12 columns, h a span over its 160px
// rows (same geometry the 6.7 grid used, so muscle memory carries over).

export type PanelId = 'balance' | 'history' | 'log' | 'streaks' | 'controls' | 'next' | 'catalog' | 'orders' | 'news'

// One designed size of one tile, in grid units.
export interface TileStep {
  w: number
  h: number
}

export interface TileMeta {
  id: PanelId
  title: string
  // The designed sizes — a LATTICE, ordered small → large by AREA (then
  // width, for determinism): width and height step independently (user
  // request, 2026-09-11: "I do not like how I can't really resize them" —
  // a pure chain would leave a middle step's other axis unreachable). The
  // grip's snap picks the nearest step as a PAIR, in px, so any drag lands
  // on a designed size from any direction. The per-axis minima/maxima are
  // the hard floor/ceiling (see stepFloor/stepCeiling); the step INDEX picks
  // the content variant (tiles read their step's own w/h for that — see the
  // tiles).
  steps: TileStep[]
  // Which step the default board seats the tile at.
  defaultStep: number
  // The tile's seat on the DEFAULT board (explicit coordinates — the board
  // is data here, not an algorithm; layout/migrate.ts tests keep it packed
  // and collision-free). 2026-09-11, user request "Set the default layout
  // to be my current layout": the default board IS the arrangement the user
  // had built and saved in their own storage, read straight out of their
  // stored dashLayout doc — three 4-wide columns (balance/controls/news,
  // history/next/log, streaks/catalog/orders), every tile on a 4-wide
  // designed step.
  seat: { x: number; y: number }
}

// The board's geometry — one place for the wrapper, the snap math and the
// tests to agree on. Mirrors the 6.7 grid exactly: 12 columns, 160px rows,
// 16px gutters, no container padding (the page's .dash-grid carries the
// page padding instead).
export const GRID_COLS = 12
export const GRID_ROW_HEIGHT = 160
export const GRID_MARGIN: readonly [number, number] = [16, 16]
export const GRID_CONTAINER_PADDING: readonly [number, number] = [0, 0]

export const TILES: Record<PanelId, TileMeta> = {
  balance: {
    id: 'balance',
    title: 'Balance',
    // 2026-09-11 rework: the heights join the lattice (user: "I do not like
    // how I can't really resize them"), and the compact step keeps its hero
    // in ONE row with a scaled-down ring so the stat tiles below always fit
    // (user: "when I make the balance section smaller, some components get
    // hidden. Fix it").
    steps: [
      { w: 3, h: 2 },
      { w: 4, h: 2 },
      { w: 4, h: 3 },
      { w: 6, h: 2 },
      { w: 6, h: 3 },
    ],
    defaultStep: 1,
    seat: { x: 0, y: 0 },
  },
  history: {
    id: 'history',
    title: 'Points history',
    // 2026-09-11: 1-tall steps join the lattice (user: "The graph should
    // also be able to scale down") — the compact strip is the chart alone,
    // the goal bar and the note drop (CSS).
    steps: [
      { w: 4, h: 1 },
      { w: 6, h: 1 },
      { w: 4, h: 2 },
      { w: 6, h: 2 },
      { w: 8, h: 2 },
    ],
    defaultStep: 0,
    seat: { x: 4, y: 0 },
  },
  streaks: {
    id: 'streaks',
    title: "Today's streaks",
    // 2026-09-11 rework: the cards FILL the seat at every step (user: "I
    // want them to take the whole place, not only to show a small square in
    // the top left. It's too small for the section") — 1×4 rows, a 2×2 quad
    // at the narrow step, and 1-tall strips (the "1:4" seat the user asked
    // for: "I should be able to make the section 1:4").
    steps: [
      { w: 4, h: 1 },
      { w: 3, h: 2 },
      { w: 6, h: 1 },
      { w: 4, h: 2 },
      { w: 8, h: 1 },
      { w: 6, h: 2 },
    ],
    defaultStep: 0,
    seat: { x: 8, y: 0 },
  },
  controls: {
    id: 'controls',
    title: 'Run controls',
    // 2026-09-11 rework: a full lattice (user: "I do not like how I can't
    // really resize them") — and the form compacts to FIT the 4×3 seat with
    // no scroll (user: "There should be no scroll in… run control sections.
    // They should adjust to the section size"), spreading four-across from
    // 6 wide.
    steps: [
      { w: 4, h: 3 },
      { w: 4, h: 4 },
      { w: 6, h: 3 },
      { w: 6, h: 4 },
      { w: 8, h: 3 },
      { w: 8, h: 4 },
    ],
    defaultStep: 0,
    seat: { x: 0, y: 2 },
  },
  next: {
    id: 'next',
    title: 'Next routine',
    steps: [
      { w: 2, h: 2 },
      { w: 4, h: 2 },
    ],
    defaultStep: 1,
    seat: { x: 4, y: 1 },
  },
  catalog: {
    id: 'catalog',
    title: 'Overwatch coins — catalog',
    // 2026-09-11: 1-tall steps join the list (user: "The overwatch catalog
    // should be able to make it a 1:4 layout") — the one-row coin lines at
    // 4 and 6 wide, beside the original 2×1 mini.
    steps: [
      { w: 2, h: 1 },
      { w: 4, h: 1 },
      { w: 6, h: 1 },
      { w: 4, h: 2 },
      { w: 6, h: 2 },
    ],
    defaultStep: 1,
    seat: { x: 8, y: 1 },
  },
  news: {
    id: 'news',
    title: 'Stock news',
    steps: [
      { w: 3, h: 1 },
      { w: 4, h: 2 },
    ],
    defaultStep: 1,
    seat: { x: 0, y: 5 },
  },
  orders: {
    id: 'orders',
    title: 'Order history',
    // 2026-09-11: taller steps joined the list (user: "I should be able to
    // make the order history taller") — and narrower ones too (user, same
    // day: "The order history should be able to get smaller than 5 points of
    // width"): 3- and 4-wide seats at every useful height, so the list can
    // slim down without collapsing to the 2×1 mini.
    steps: [
      { w: 2, h: 1 },
      { w: 3, h: 3 },
      { w: 4, h: 3 },
      { w: 4, h: 4 },
      { w: 4, h: 5 },
      { w: 6, h: 4 },
      { w: 6, h: 5 },
      { w: 6, h: 6 },
    ],
    defaultStep: 3,
    seat: { x: 8, y: 2 },
  },
  log: {
    id: 'log',
    title: 'Activity log',
    // 2026-09-11: taller steps join the list (user, same day: "Also, the
    // activity log").
    steps: [
      { w: 4, h: 2 },
      { w: 4, h: 3 },
      { w: 6, h: 3 },
      { w: 6, h: 4 },
      { w: 6, h: 5 },
    ],
    defaultStep: 1,
    seat: { x: 4, y: 3 },
  },
}

export const PANEL_IDS: PanelId[] = Object.keys(TILES) as PanelId[]

// A tile's hard bounds: each axis's min/max ACROSS ITS STEPS. In a lattice
// the smallest-area step (index 0) is not the narrowest nor the shortest —
// e.g. streaks' floor step is 4×1 but the 3-wide quad step is legal — so
// the floor must be the per-axis minima, or a legal step gets clamped away
// on read (found live: the 3×2 quad rendered as 4×2). The ceiling pair need
// not be a designed step itself — minMaxSize clamps each axis before the
// snap runs.
export function stepFloor(meta: TileMeta): TileStep {
  return {
    w: Math.min(...meta.steps.map((s) => s.w)),
    h: Math.min(...meta.steps.map((s) => s.h)),
  }
}
export function stepCeiling(meta: TileMeta): TileStep {
  return {
    w: Math.max(...meta.steps.map((s) => s.w)),
    h: Math.max(...meta.steps.map((s) => s.h)),
  }
}

export function metaOf(id: string): TileMeta | undefined {
  return (TILES as Record<string, TileMeta>)[id]
}
