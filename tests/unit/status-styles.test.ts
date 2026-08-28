import { describe, it, expect } from 'vitest'
import { dealStatusStyle, offerStatusStyle } from '@/lib/status-styles'

// The enum values as stored in the DB (Database['public']['Enums']). Kept literal here so a schema
// change that drops/renames a status surfaces as a failing test rather than a silent gray fallback.
const DEAL_STATUSES = ['draft', 'submitted', 'offer_received', 'accepted', 'confirmed', 'funded', 'expired', 'cancelled'] as const
const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'switched', 'withdrawn'] as const

describe('dealStatusStyle', () => {
  it('returns bg + text classes for every deal status', () => {
    for (const s of DEAL_STATUSES) {
      const cls = dealStatusStyle(s)
      expect(cls, s).toMatch(/\bbg-\S+/)
      expect(cls, s).toMatch(/\btext-\S+/)
    }
  })

  it('maps accepted to green and confirmed/funded to emerald', () => {
    expect(dealStatusStyle('accepted')).toContain('green')
    expect(dealStatusStyle('confirmed')).toBe(dealStatusStyle('funded'))
    expect(dealStatusStyle('confirmed')).toContain('emerald')
  })
})

describe('offerStatusStyle', () => {
  it('returns bg + text classes for every offer status', () => {
    for (const s of OFFER_STATUSES) {
      const cls = offerStatusStyle(s)
      expect(cls, s).toMatch(/\bbg-\S+/)
      expect(cls, s).toMatch(/\btext-\S+/)
    }
  })

  it('regression: a declined offer is gray, not red (single source of truth)', () => {
    // This is exactly the divergence status-styles.ts consolidated (gray on Submitted Offers vs red
    // on Deal Detail) — lock it so a future palette edit can't reintroduce the split.
    const declined = offerStatusStyle('declined')
    expect(declined).toContain('gray')
    expect(declined).not.toContain('red')
  })

  it('pending is the default yellow', () => {
    expect(offerStatusStyle('pending')).toContain('yellow')
  })
})
