// The dashboard reads — the routine's opening step and the popup's Refresh
// button. The readers live in readers/stats and readers/redeem with their
// page-side halves in injections; this module is the seam the search step and
// the routine import, so the import graph stays stable no matter where a
// reader moves.
//
// The redeem watch joins the stats read as the routine step's second half
// (src-donut's runStartupReads did the same): the numbers and the coin catalog are
// read in one opening burst, and both refuse to double up through the shared
// READ_RUN_GUARDS if the popup's Refresh fired them moments earlier.

export { refreshStats, READ_RUN_GUARDS } from '../readers/stats.ts'
export { checkRedeemAvailability } from '../readers/redeem.ts'
