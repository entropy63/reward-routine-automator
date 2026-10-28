import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'
import { normalizeSettings, validateSettings } from '../src/shared/settings-validation.ts'

test('stored settings keep valid user preferences while invalid fields fall back individually', () => {
  const input = { theme: 'nord', startupEnabled: false, hiddenSections: null, minDelaySec: NaN, background: {}, searchesPerBatch: -1, quietHoursStart: 'not a time' }
  const normalized = normalizeSettings(input, DEFAULT_SETTINGS)
  assert.equal(normalized.theme, 'nord')
  assert.equal(normalized.startupEnabled, false)
  assert.deepEqual(normalized.hiddenSections, DEFAULT_SETTINGS.hiddenSections)
  assert.equal(normalized.searchesPerBatch, DEFAULT_SETTINGS.searchesPerBatch)
  assert.deepEqual(input.hiddenSections, null)
  assert.deepEqual(normalizeSettings(null, DEFAULT_SETTINGS), DEFAULT_SETTINGS)
})

test('strict validation rejects invalid patches, unknown steps and reversed pacing', () => {
  for (const invalid of [{ startupEnabled: 'yes' }, { startupOrder: ['bogus'] }, { popupHeight: 10 }, { minDelaySec: 20, maxDelaySec: 10 }]) assert.throws(() => validateSettings(invalid, DEFAULT_SETTINGS))
  assert.deepEqual(validateSettings({ theme: 'nord', unknownFuture: true }, DEFAULT_SETTINGS), { theme: 'nord' })
  assert.deepEqual(validateSettings({ quietHoursStart: '23:59', quietHoursEnd: '07:00' }, DEFAULT_SETTINGS), { quietHoursStart: '23:59', quietHoursEnd: '07:00' })
  const normalized = normalizeSettings({ minDelaySec: 30, maxDelaySec: 10 }, DEFAULT_SETTINGS)
  assert.ok(normalized.maxDelaySec >= normalized.minDelaySec)
})
