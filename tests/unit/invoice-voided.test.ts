import { describe, it, expect } from 'vitest'
import { listLenderInvoices, type LenderInvoiceItem } from '@/lib/queries/offers'
import { listAllInvoices, type AdminInvoiceRow } from '@/lib/queries/admin'
import { Constants, type Database } from '@/lib/database.types'

/**
 * Static/runtime contract checks for the 'voided' invoice status (migration 85/86, 2026-09-04) — the
 * UI/query/type/i18n half of that work, as opposed to the RPC/business-logic behavior smoke-switch.mjs
 * and smoke-invoice-archive.mjs cover against a live database. This file needs no DB: the query
 * functions take an injected client, so a fake one that just records the select() string and returns
 * canned rows is enough to prove the mapping is real, not merely typed.
 */

// Compile-time canaries: these only compile if 'voided' is actually a member of each union. Vitest's
// esbuild transform does NOT typecheck (it strips types), so these values are also read in a real
// assertion below — but the primary guarantee here is `pnpm typecheck` failing to build this file at
// all if 'voided' is ever removed from one of these types without the others following.
const invoiceStatusCanary: Database['public']['Enums']['invoice_status'] = 'voided'
const lenderStatusCanary: LenderInvoiceItem['status'] = 'Voided'
const adminStatusCanary: AdminInvoiceRow['status'] = 'voided'

/** Minimal fake mimicking `supabase.from(table).select(sel).order(...)`, capturing the select string. */
function fakeInvoicesClient(rows: Record<string, unknown>[]) {
  let capturedSelect = ''
  const client = {
    from(_table: string) {
      return {
        select(sel: string) {
          capturedSelect = sel
          return {
            order() {
              return Promise.resolve({ data: rows, error: null })
            },
          }
        },
      }
    },
  }
  return { client, getSelect: () => capturedSelect }
}

describe('invoice_status "voided" — type contract', () => {
  it('is a member of the database enum, LenderInvoiceItem, and AdminInvoiceRow status types', () => {
    expect(invoiceStatusCanary).toBe('voided')
    expect(lenderStatusCanary).toBe('Voided')
    expect(adminStatusCanary).toBe('voided')
  })

  it('is present in the hand-edited runtime Constants export alongside the original three', () => {
    expect(Constants.public.Enums.invoice_status).toEqual(['pending', 'paid', 'cancelled', 'voided'])
  })
})

describe('listLenderInvoices — voided mapping (lib/queries/offers.ts)', () => {
  it('selects voided_at/voided_reason and maps a voided row correctly', async () => {
    const { client, getSelect } = fakeInvoicesClient([
      {
        id: 'inv-a', invoice_number: 'INV-04092026-1', loan_amount: 500000, term_years: 5,
        mortgage_product: '5_year_fixed', platform_bps: 4, amount: 200, closing_date: '2026-10-01',
        due_date: '2026-10-22', status: 'voided', paid_at: null, cancelled_at: null,
        voided_at: '2026-09-04T12:00:00.000Z', voided_reason: 'Superseded by lender switch',
        created_at: '2026-09-01T00:00:00.000Z', document_name: null,
        deals: { deal_number: 'DEAL-2026-900', city: 'Toronto', province: 'ontario', purpose: 'purchase' },
      },
    ])

    const result = await listLenderInvoices(client as any)

    expect(getSelect()).toEqual(expect.stringContaining('voided_at'))
    expect(getSelect()).toEqual(expect.stringContaining('voided_reason'))
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('Voided')
    expect(result[0].voidedDate).toBe('2026-09-04')
    expect(result[0].voidedReason).toBe('Superseded by lender switch')
  })
})

describe('listAllInvoices — voided + cancelled-reason mapping (lib/queries/admin.ts)', () => {
  it('selects voided_at/voided_reason/cancelled_reason and maps both a voided and a cancelled row', async () => {
    const { client, getSelect } = fakeInvoicesClient([
      {
        id: 'inv-a', invoice_number: 'INV-04092026-1', loan_amount: 500000, amount: 200,
        mortgage_product: '5_year_fixed', platform_bps: 4, client_name: 'Test Borrower',
        due_date: '2026-10-22', status: 'voided', paid_at: null,
        cancelled_at: null, cancelled_reason: null,
        voided_at: '2026-09-04T12:00:00.000Z', voided_reason: 'Superseded by lender switch',
        archived_at: null, created_at: '2026-09-01T00:00:00.000Z',
        deals: { deal_number: 'DEAL-2026-900' },
        profiles: { first_name: 'Lena', last_name: 'Doe', lender_institutions: { name: 'RFA' } },
      },
      {
        id: 'inv-b', invoice_number: 'INV-04092026-2', loan_amount: 400000, amount: 160,
        mortgage_product: '5_year_fixed', platform_bps: 4, client_name: 'Another Borrower',
        due_date: '2026-10-22', status: 'cancelled', paid_at: null,
        cancelled_at: '2026-09-02T00:00:00.000Z', cancelled_reason: 'Requested by lender',
        voided_at: null, voided_reason: null,
        archived_at: null, created_at: '2026-09-01T00:00:00.000Z',
        deals: { deal_number: 'DEAL-2026-901' },
        profiles: { first_name: 'Sam', last_name: 'Roe', lender_institutions: null },
      },
    ])

    const result = await listAllInvoices(client as any)

    expect(getSelect()).toEqual(expect.stringContaining('voided_at'))
    expect(getSelect()).toEqual(expect.stringContaining('voided_reason'))
    expect(getSelect()).toEqual(expect.stringContaining('cancelled_reason'))

    const voided = result.find((r) => r.id === 'inv-a')
    expect(voided?.status).toBe('voided')
    expect(voided?.voidedDate).toBe('2026-09-04')
    expect(voided?.voidedReason).toBe('Superseded by lender switch')
    expect(voided?.cancelledReason).toBeNull()

    const cancelled = result.find((r) => r.id === 'inv-b')
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.cancelledReason).toBe('Requested by lender')
    expect(cancelled?.voidedDate).toBeNull()
  })
})
