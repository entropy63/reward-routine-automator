// The dashboard reads — the routine's opening step and the popup's Refresh
// button. The readers live in readers/ (stats, redeem) with their page-side
// halves in injections/; this module is the seam the search step and the
// routine import, so the import graph stays stable no matter where a reader
// moves.

export { refreshStats } from "../readers/stats.js";
export { checkRedeemAvailability } from "../readers/redeem.js";
