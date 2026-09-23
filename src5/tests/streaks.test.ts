import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStreak, parseStarCount } from '../src/background/pure/streaks.ts'

// The streak parser: "Day 4 of 7 · 1/1" is the Earn card's full answer, a
// bare "1/1" the dashboard tile's. Both halves are optional; nothing usable
// means null, never a guessed zero.

test('the full streak card value parses into both halves', () => {
  assert.deepEqual(parseStreak('Day 4 of 7 · 1/1'), { day: 4, of: 7, done: 1, total: 1 })
  assert.deepEqual(parseStreak('Day 12 of 30 · 0/3'), { day: 12, of: 30, done: 0, total: 3 })
})

test('a day line alone or a progress pair alone still answers', () => {
  assert.deepEqual(parseStreak('Day 4 of 7'), { day: 4, of: 7, done: null, total: null })
  assert.deepEqual(parseStreak('2/3'), { day: null, of: null, done: 2, total: 3 })
})

test('junk input never throws and never invents a streak', () => {
  for (const junk of [null, undefined, '', '   ', 'Day of', 'earned last month: 420/420 pts', '—']) {
    assert.equal(parseStreak(junk), null, `${JSON.stringify(junk)} must parse to null`)
  }
})

test('spaced pairs and stray case still parse', () => {
  assert.deepEqual(parseStreak('2 / 3'), { day: null, of: null, done: 2, total: 3 })
  assert.deepEqual(parseStreak('day 6 of 7 · 3/3'), { day: 6, of: 7, done: 3, total: 3 })
})

test('the star count only accepts a bare lit/total pair', () => {
  assert.deepEqual(parseStarCount('3/12'), { lit: 3, total: 12 })
  assert.deepEqual(parseStarCount(' 11/12 '), { lit: 11, total: 12 })
  // Points strings, prose, and impossible fractions carry no star signal.
  for (const junk of [null, undefined, '', '1,000 pts', '3×', 'Day 4 of 7 · 1/1', '13/12', '0/0']) {
    assert.equal(parseStarCount(junk), null, `${JSON.stringify(junk)} must not read as stars`)
  }
})
