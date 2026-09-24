// The query chain: recent-repeat avoidance and the prefetch pair, tested
// through the generator seam instead of an extraction harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installChrome } from "./helpers.js";

installChrome();

const { nextQuery, startQueryPrefetch, awaitedQuery, setQueryGenerator } = await import(
  "../queries/chain.js"
);

// A scripted generator: hands out the given queries in order, rejecting with
// the given error when an entry is an Error.
function scripted(steps) {
  let calls = 0;
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...args) => warns.push(String(args[0]));
  return {
    calls: () => calls,
    warns: () => warns,
    restore() {
      console.warn = realWarn;
    },
    generate: async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls++;
      if (step instanceof Error) throw step;
      return { query: step, api: "scripted" };
    }
  };
}

test("nextQuery records what it chose in the recent list", async t => {
  const gen = scripted(["first query", "second query"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  await nextQuery();
  const { recentQueries } = await chrome.storage.local.get("recentQueries");
  assert.deepEqual(recentQueries, ["first query"]);
});

test("nextQuery avoids a query the recent list already holds", async t => {
  await chrome.storage.local.set({ recentQueries: ["seen already"] });
  const gen = scripted(["seen already", "seen already", "fresh one"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  const chosen = await nextQuery();
  assert.equal(chosen.query, "fresh one");
  assert.equal(gen.calls(), 3); // two rejects, one accept
  const { recentQueries } = await chrome.storage.local.get("recentQueries");
  assert.deepEqual(recentQueries, ["fresh one", "seen already"]);
});

test("the prefetch fills the idle window — one generate serves one search", async t => {
  await chrome.storage.local.remove("recentQueries");
  const gen = scripted(["warm query", "cold query"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  startQueryPrefetch();
  const warm = await awaitedQuery();
  assert.equal(warm.query, "warm query");
  assert.equal(gen.calls(), 1); // the cold fetch never ran
});

test("a second awaitedQuery with no prefetch in flight fetches cold", async t => {
  await chrome.storage.local.remove("recentQueries");
  const gen = scripted(["warm query", "cold query"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  startQueryPrefetch();
  await awaitedQuery();
  const cold = await awaitedQuery();
  assert.equal(cold.query, "cold query");
  assert.equal(gen.calls(), 2);
});

test("a failed prefetch falls back to a fresh fetch, with a warn", async t => {
  const gen = scripted([new Error("network died"), "recovered query"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  startQueryPrefetch();
  const recovered = await awaitedQuery();
  assert.equal(recovered.query, "recovered query");
  assert.equal(gen.calls(), 2);
  assert.ok(gen.warns().some(w => w.includes("Prefetched query failed")));
});

test("only one prefetch is ever in flight", async t => {
  await chrome.storage.local.remove("recentQueries");
  const gen = scripted(["a", "b", "c"]);
  t.after(() => gen.restore());
  setQueryGenerator(gen.generate);

  startQueryPrefetch();
  startQueryPrefetch(); // the batch-start call while one is already running
  startQueryPrefetch();
  const warm = await awaitedQuery();
  assert.equal(warm.query, "a");
  assert.equal(gen.calls(), 1);
});
