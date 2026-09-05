import { describe, it, expect } from 'vitest'
import {
  listAllInvoices,
  adminUpdateInvoice,
  adminVoidInvoice,
  getInvoiceSettings,
  setInvoiceSettings,
} from '@/lib/queries/admin'

/**
 * Query-layer contract for Admin Invoice Management (migration 87, 2026-09-04). No DB — fakes just
 * enough of the supabase-js chain to prove (a) the right table/RPC is called, (b) the right
 * parameters are sent, and (c) the response is mapped into the shape the UI expects. The actual
 * server-side recalculation/validation is proven live against Postgres by
 * scripts/smoke-admin-invoice-management.mjs; this file only proves the client-side wiring is correct.
 */

function fakeSelectClient(rows: Record<string, unknown>[]) {
  let capturedSelect = ''
  const client = {
    from(_table: string) {
      return {
        select(sel: string) {
          capturedSelect = sel
          return { order: () => Promise.resolve({ data: rows, error: null }) }
        },
      }
    },
  }
  return { client, getSelect: () => capturedSelect }
}

function fakeRpcClient(returnRow: Record<string, unknown>) {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args
      return Promise.resolve({ data: returnRow, error: null })
    },
  }
  return { client, getCall: () => ({ name: capturedName, args: capturedArgs }) }
}

const baseInvoiceRow = {
  id: 'inv-1', invoice_number: 'INV-04092026-1', loan_amount: 500000, amount: 945,
  mortgage_product: '5_year_fixed', platform_bps: 4, client_name: 'Test Borrower',
  due_date: '2026-10-22', status: 'pending', paid_at: null,
  cancelled_at: null, cancelled_reason: null, voided_at: null, voided_reason: null,
  archived_at: null, created_at: '2026-09-01T00:00:00.000Z',
  subtotal: 1000, discount_amount: 100, discount_reason: 'Loyalty discount',
  tax_lines: [{ label: 'GST', rate: 5, amount: 45 }], tax_total: 45,
  description: 'Custom description', billing_reference: 'REF-1', notes: 'Some notes',
  payment_instructions: 'Pay via EFT', revision_number: 3,
  deals: { deal_number: 'DEAL-2026-902' },
  profiles: { first_name: 'Lena', last_name: 'Doe', lender_institutions: { name: 'RFA' } },
}

describe('listAllInvoices — admin financial fields', () => {
  it('selects every new financial/content column and maps them onto AdminInvoiceRow', async () => {
    const { client, getSelect } = fakeSelectClient([baseInvoiceRow])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listAllInvoices(client as any)

    for (const col of ['subtotal', 'discount_amount', 'discount_reason', 'tax_lines', 'tax_total',
      'description', 'billing_reference', 'notes', 'payment_instructions', 'revision_number']) {
      expect(getSelect()).toEqual(expect.stringContaining(col))
    }

    expect(result).toHaveLength(1)
    const row = result[0]
    expect(row.subtotal).toBe(1000)
    expect(row.discountAmount).toBe(100)
    expect(row.discountReason).toBe('Loyalty discount')
    expect(row.taxLines).toEqual([{ label: 'GST', rate: 5, amount: 45 }])
    expect(row.taxTotal).toBe(45)
    expect(row.description).toBe('Custom description')
    expect(row.billingReference).toBe('REF-1')
    expect(row.notes).toBe('Some notes')
    expect(row.paymentInstructions).toBe('Pay via EFT')
    expect(row.revisionNumber).toBe(3)
  })

  it('falls back to an empty tax-line array and nulls for a legacy-shaped row', async () => {
    const legacyRow = { ...baseInvoiceRow, tax_lines: null, description: null, billing_reference: null, notes: null, payment_instructions: null, discount_reason: null }
    const { client } = fakeSelectClient([legacyRow])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listAllInvoices(client as any)
    expect(result[0].taxLines).toEqual([])
    expect(result[0].description).toBeNull()
  })
})

describe('adminUpdateInvoice — RPC wiring', () => {
  it('calls admin_update_invoice with the expected parameter shape (no total is ever sent)', async () => {
    const { client, getCall } = fakeRpcClient(baseInvoiceRow)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await adminUpdateInvoice(client as any, 'inv-1', {
      subtotal: 1000,
      discountAmount: 100,
      discountReason: 'Loyalty discount',
      taxLines: [{ label: 'GST', rate: 5 }],
      description: 'Custom description',
      billingReference: 'REF-1',
      notes: 'Some notes',
      paymentInstructions: 'Pay via EFT',
      dueDate: '2026-10-22',
      changeReason: 'Smoke test edit',
    })

    const call = getCall()
    expect(call.name).toBe('admin_update_invoice')
    expect(call.args.p_invoice_id).toBe('inv-1')
    expect(call.args.p_subtotal).toBe(1000)
    expect(call.args.p_discount_amount).toBe(100)
    expect(call.args.p_tax_lines).toEqual([{ label: 'GST', rate: 5 }])
    // The wrapper's input type has no "amount"/"total" field at all — the strongest proof at the
    // TypeScript level that this call site cannot send a client-computed total.
    expect(call.args).not.toHaveProperty('p_amount')
    expect(result.revisionNumber).toBe(3)
  })
})

describe('adminVoidInvoice — RPC wiring', () => {
  it('calls admin_void_invoice with the invoice id and reason', async () => {
    const voidedRow = { ...baseInvoiceRow, status: 'voided', voided_at: '2026-09-04T00:00:00.000Z', voided_reason: 'Duplicate invoice' }
    const { client, getCall } = fakeRpcClient(voidedRow)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await adminVoidInvoice(client as any, 'inv-1', 'Duplicate invoice')
    const call = getCall()
    expect(call.name).toBe('admin_void_invoice')
    expect(call.args).toEqual({ p_invoice_id: 'inv-1', p_reason: 'Duplicate invoice' })
    expect(result.status).toBe('voided')
    expect(result.voidedReason).toBe('Duplicate invoice')
  })
})

describe('Invoice Settings — read/write wiring', () => {
  it('getInvoiceSettings reads the singleton row and maps defaultTaxLines', async () => {
    const client = {
      from: (_t: string) => ({
        select: (_s: string) => ({
          eq: (_c: string, _v: unknown) => ({
            single: () =>
              Promise.resolve({
                data: {
                  header_text: 'Custom Title', default_description: 'Default desc', footer_text: null,
                  default_payment_instructions: 'Pay by EFT',
                  default_tax_lines: [{ label: 'HST', rate: 13 }],
                  updated_at: '2026-09-04T00:00:00.000Z',
                },
                error: null,
              }),
          }),
        }),
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = await getInvoiceSettings(client as any)
    expect(settings.headerText).toBe('Custom Title')
    expect(settings.defaultTaxLines).toEqual([{ label: 'HST', rate: 13 }])
  })

  it('setInvoiceSettings calls set_invoice_settings with the admin-provided defaults', async () => {
    const { client, getCall } = fakeRpcClient({
      header_text: 'Custom Title', default_description: 'Default desc', footer_text: null,
      default_payment_instructions: 'Pay by EFT', default_tax_lines: [{ label: 'HST', rate: 13 }],
      updated_at: '2026-09-04T00:00:00.000Z',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await setInvoiceSettings(client as any, {
      headerText: 'Custom Title', defaultDescription: 'Default desc', footerText: null,
      defaultPaymentInstructions: 'Pay by EFT', defaultTaxLines: [{ label: 'HST', rate: 13 }],
    })
    const call = getCall()
    expect(call.name).toBe('set_invoice_settings')
    expect(call.args.p_default_tax_lines).toEqual([{ label: 'HST', rate: 13 }])
    expect(result.defaultTaxLines).toEqual([{ label: 'HST', rate: 13 }])
  })
})
