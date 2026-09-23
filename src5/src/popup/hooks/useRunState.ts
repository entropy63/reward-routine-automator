import { KEYS } from '../../shared/storage.ts'
import type { RunState } from '../../shared/storage.ts'
import { useStorageValue } from './useStorageValue.ts'

// The empty run-state document: what "nothing is running" looks like, matching
// the shape core/run-state.ts persists. A module constant so its reference is
// stable across renders (the hook's fallback).
const IDLE: RunState = {
  v: 1,
  stopEpoch: 0,
  activity: null,
  batch: null,
  rightSizeRun: null,
  routine: null,
  captures: { capturing: [], opened: {} },
}

// The live "what is running right now" document. Used for the status pill, the
// Run view's Stop affordance, and the Activity view's live line.
export function useRunState(): RunState {
  return useStorageValue<RunState>('local', KEYS.runState, IDLE).value
}
