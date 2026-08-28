import type { Database } from '@/lib/database.types'

type DealStatus = Database['public']['Enums']['deal_status']
type OfferStatus = Database['public']['Enums']['offer_status']

/**
 * Single source of truth for status-pill colors. Several pages hand-rolled their own palette and drifted
 * (e.g. a declined offer was gray on Submitted Offers but red on Deal Detail) — everything should route
 * through these so the same status always reads the same color. Returns Tailwind `bg-* text-*` classes;
 * callers add their own shape/size (rounded-full, padding) + optional status icon.
 */
export function dealStatusStyle(status: DealStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800'
    case 'submitted':
      return 'bg-blue-100 text-blue-800'
    case 'offer_received':
      return 'bg-yellow-100 text-yellow-800'
    case 'accepted':
      return 'bg-green-100 text-green-800'
    case 'confirmed':
    case 'funded':
      return 'bg-emerald-100 text-emerald-800'
    case 'expired':
    case 'cancelled':
      return 'bg-slate-100 text-slate-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function offerStatusStyle(status: OfferStatus): string {
  switch (status) {
    case 'accepted':
      return 'bg-green-100 text-green-800'
    case 'declined':
      return 'bg-gray-100 text-gray-800'
    case 'switched':
    case 'withdrawn':
      return 'bg-slate-100 text-slate-600'
    default: // pending
      return 'bg-yellow-100 text-yellow-800'
  }
}
