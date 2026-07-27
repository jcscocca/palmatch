import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAIN_DEPTH, MAX_PARENT_PASSIVES, createWorkbenchStore, modeFor, normalizeSlots } from './store.ts'

describe('normalizeSlots', () => {
  it('treats slot A as primary, with B as secondary, when both are filled', () => {
    expect(normalizeSlots({ slotA: 1, slotB: 2, target: null })).toEqual({ primary: 1, secondary: 2 })
  })

  it('treats slot A as primary, alone, when only A is filled', () => {
    expect(normalizeSlots({ slotA: 1, slotB: null, target: null })).toEqual({ primary: 1, secondary: null })
  })

  it('promotes slot B to primary, with no secondary, when only B is filled', () => {
    expect(normalizeSlots({ slotA: null, slotB: 2, target: null })).toEqual({ primary: 2, secondary: null })
  })

  it('has no primary when both parent slots are empty', () => {
    expect(normalizeSlots({ slotA: null, slotB: null, target: 9 })).toEqual({ primary: null, secondary: null })
  })
})

describe('modeFor', () => {
  it('is empty when nothing is filled', () => {
    expect(modeFor({ slotA: null, slotB: null, target: null })).toBe('empty')
  })

  it('is a-only when only slot A is filled', () => {
    expect(modeFor({ slotA: 1, slotB: null, target: null })).toBe('a-only')
  })

  it('is a-only when only slot B is filled - B normalizes to the primary slot', () => {
    expect(modeFor({ slotA: null, slotB: 2, target: null })).toBe('a-only')
  })

  it('is pair when both parent slots are filled and there is no target', () => {
    expect(modeFor({ slotA: 1, slotB: 2, target: null })).toBe('pair')
  })

  it('is target when only the target is filled', () => {
    expect(modeFor({ slotA: null, slotB: null, target: 3 })).toBe('target')
  })

  it('is chain when slot A and target are filled, slot B optional', () => {
    expect(modeFor({ slotA: 1, slotB: null, target: 3 })).toBe('chain')
    expect(modeFor({ slotA: 1, slotB: 2, target: 3 })).toBe('chain')
  })

  it('is chain when only slot B and target are filled - B stands in as the starter', () => {
    expect(modeFor({ slotA: null, slotB: 2, target: 3 })).toBe('chain')
  })
})

describe('createWorkbenchStore', () => {
  it('starts empty with the documented defaults', () => {
    const store = createWorkbenchStore()
    const s = store.getState()
    expect(s.slotA).toBeNull()
    expect(s.slotB).toBeNull()
    expect(s.target).toBeNull()
    expect(s.tab).toBeNull()
    expect(s.chainDepth).toBe(DEFAULT_CHAIN_DEPTH)
    expect(s.parentPassives).toEqual({ a: [], b: [] })
    expect(s.desiredPassives).toEqual([])
  })

  it('gives independent state to each instance', () => {
    const storeA = createWorkbenchStore()
    const storeB = createWorkbenchStore()
    storeA.getState().setSlot('a', 5)
    expect(storeA.getState().slotA).toBe(5)
    expect(storeB.getState().slotA).toBeNull()
  })

  it('sets the requested slot and clears the active tab, since it may not exist in the new mode', () => {
    const store = createWorkbenchStore()
    store.getState().setTab('mutations')
    store.getState().setSlot('a', 7)
    expect(store.getState().slotA).toBe(7)
    expect(store.getState().tab).toBeNull()

    store.getState().setTab('mutations')
    store.getState().setSlot('b', 9)
    expect(store.getState().slotB).toBe(9)
    expect(store.getState().tab).toBeNull()

    store.getState().setTab('mutations')
    store.getState().setSlot('t', 11)
    expect(store.getState().target).toBe(11)
    expect(store.getState().tab).toBeNull()
  })

  it('keeps the active tab when a slot change does not switch modes', () => {
    const store = createWorkbenchStore()
    store.getState().setSlot('a', 1)
    store.getState().setSlot('b', 2) // pair mode
    store.getState().setTab('mutations')

    store.getState().setSlot('b', 3) // still pair mode, just a different B partner
    expect(store.getState().slotB).toBe(3)
    expect(store.getState().tab).toBe('mutations')
  })

  it('never holds slotB while slotA is null: filling B alone promotes it to A', () => {
    const store = createWorkbenchStore()
    store.getState().setSlot('b', 4)
    expect(store.getState().slotA).toBe(4)
    expect(store.getState().slotB).toBeNull()
  })

  it('never holds slotB while slotA is null: clearing A shifts B down into A', () => {
    const store = createWorkbenchStore()
    store.getState().setSlot('a', 1)
    store.getState().setSlot('b', 2)
    store.getState().setSlot('a', null)
    expect(store.getState().slotA).toBe(2)
    expect(store.getState().slotB).toBeNull()
  })

  it('setSlot(slot, null) clears just that slot when the invariant is not implicated', () => {
    const store = createWorkbenchStore()
    store.getState().setSlot('a', 1)
    store.getState().setSlot('b', 2)

    store.getState().setSlot('b', null)
    expect(store.getState().slotA).toBe(1)
    expect(store.getState().slotB).toBeNull()

    store.getState().setSlot('t', 9)
    store.getState().setSlot('t', null)
    expect(store.getState().target).toBeNull()
  })

  it('setSlot(slot, null) on an already-empty slot is a no-op', () => {
    const store = createWorkbenchStore()
    store.getState().setSlot('a', null)
    expect(store.getState().slotA).toBeNull()
    expect(store.getState().slotB).toBeNull()
  })

  it('clamps declared parent passives to the documented max', () => {
    const store = createWorkbenchStore()
    store.getState().setParentPassives('a', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    expect(store.getState().parentPassives.a).toHaveLength(MAX_PARENT_PASSIVES)
    expect(store.getState().parentPassives.a).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(store.getState().parentPassives.b).toEqual([])
  })

  it('resets everything on clearAll', () => {
    const store = createWorkbenchStore()
    const s = store.getState()
    s.setSlot('a', 1)
    s.setSlot('b', 2)
    s.setSlot('t', 3)
    s.setChainDepth(4)
    s.setParentPassives('a', ['p1'])
    s.setDesiredPassives(['p1'])

    store.getState().clearAll()

    const after = store.getState()
    expect(after.slotA).toBeNull()
    expect(after.slotB).toBeNull()
    expect(after.target).toBeNull()
    expect(after.tab).toBeNull()
    expect(after.chainDepth).toBe(DEFAULT_CHAIN_DEPTH)
    expect(after.parentPassives).toEqual({ a: [], b: [] })
    expect(after.desiredPassives).toEqual([])
  })
})
