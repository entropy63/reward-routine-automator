// The dashboard reads — Stage 2's territory. Stage 1 ships this seam so the
// search step compiles and runs against it: refreshStats reads the Rewards
// dashboard's numbers into the lastStats key, which the right-sizing verdicts
// and the verification loop judge.
//
// Until the readers are ported (~3,400 lines of DOM extraction in src/), the
// seam is deliberately inert: it writes nothing, so lastStats stays whatever
// it was. Every consumer was designed for exactly that unknown —
// rightSizedCount falls back to the full configured batch, judgeSettlement
// returns a bare "done" on an unreadable pair — which is the honest Stage-1
// behavior: no numbers, no trimming, no verification loop, full manual
// batches that work end to end.

let warned = false;

export async function refreshStats() {
  if (!warned) {
    console.warn("reads: the dashboard readers are not ported yet (Stage 2).");
    warned = true;
  }
  return null;
}

// The redeem watch — the routine's other opening read (grouped with the
// stats read as the "stats" step). Same Stage-2 seam, same reasoning.
let redeemWarned = false;

export async function checkRedeemAvailability() {
  if (!redeemWarned) {
    console.warn("reads: the redeem watch is not ported yet (Stage 2).");
    redeemWarned = true;
  }
  return null;
}
