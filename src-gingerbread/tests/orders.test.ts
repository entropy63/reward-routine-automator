import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotMissingDefaults } from '../src/background/pure/orders.ts'

const DEFAULT = ['stats', 'claim', 'dailySet', 'keepEarning', 'search', 'imageSearch']

test('a complete saved order is returned as-is', () => {
  const saved = ['search', 'stats', 'claim', 'dailySet', 'keepEarning', 'imageSearch']
  assert.deepEqual(slotMissingDefaults(saved, DEFAULT), saved)
})

test('unknown ids are dropped and duplicates collapsed', () => {
  const saved = ['search', 'bogus', 'search', 'claim']
  const out = slotMissingDefaults(saved, DEFAULT)
  assert.ok(!out.includes('bogus'))
  assert.equal(new Set(out).size, out.length)
  // every default id is present exactly once
  assert.deepEqual([...out].sort(), [...DEFAULT].sort())
})

test('a missing id is slotted at its default index, not tacked on the end', () => {
  // saved predates "stats" (index 0 in the default) — it should land first
  const saved = ['claim', 'dailySet', 'keepEarning', 'search', 'imageSearch']
  assert.deepEqual(slotMissingDefaults(saved, DEFAULT), DEFAULT)
})

test('empty / junk input falls back to the default order', () => {
  assert.deepEqual(slotMissingDefaults([], DEFAULT), DEFAULT)
  assert.deepEqual(slotMissingDefaults(null, DEFAULT), DEFAULT)
  assert.deepEqual(slotMissingDefaults(undefined, DEFAULT), DEFAULT)
})
