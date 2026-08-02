// ═══════════════════════════════════════════════════════════════════════════
// Shared purchase catalog — the SERVER-SIDE source of truth for what each item
// costs and how many credits it grants. The browser only ever sends an item id
// (e.g. "plan:pro:monthly"); the amount is computed here so a client can never
// tamper with the price it's charged.
//
// Billed via Lemon Squeezy (merchant of record) in USD — `usd` here is the
// exact amount charged, no currency conversion needed. Imported by
// create-checkout + lemonsqueezy-webhook.
//
// Every purchase uses the SAME store variant (LEMONSQUEEZY_VARIANT_ID secret)
// — the actual price is set per-request via create-checkout's `custom_price`,
// same "one variant, dynamic price" pattern as the old Dodo integration's
// single "Pay What You Want" product. The variant/store IDs live in Supabase
// secrets, not here, since they're account-specific and were never given to
// this codebase directly.
// ═══════════════════════════════════════════════════════════════════════════

export interface CatalogItem {
  kind: 'plan' | 'addon';
  credits: number;
  usd: number;
  plan?: 'pro' | 'studio';      // set for kind:'plan'
  cycle?: 'monthly' | 'yearly'; // set for kind:'plan'
  label: string;
}

// Yearly plans grant a full year's worth of credits (12 × the monthly
// allotment) up front, since there's no recurring monthly refill mechanism —
// billing is a one-time Dodo Payments checkout, not a subscription. Without
// this, a yearly buyer got only ONE month's credits for the whole year
// (services/plans.ts advertises "200 thumbnails / month" regardless of
// cycle), which they'd burn through immediately.
export const CATALOG: Record<string, CatalogItem> = {
  'plan:pro:monthly':    { kind: 'plan',  plan: 'pro',    cycle: 'monthly', credits: 200,      usd: 39,  label: 'Pro plan (monthly)' },
  'plan:pro:yearly':     { kind: 'plan',  plan: 'pro',    cycle: 'yearly',  credits: 200 * 12, usd: 390, label: 'Pro plan (yearly)' },
  'plan:studio:monthly': { kind: 'plan',  plan: 'studio', cycle: 'monthly', credits: 750,      usd: 79,  label: 'Studio plan (monthly)' },
  'plan:studio:yearly':  { kind: 'plan',  plan: 'studio', cycle: 'yearly',  credits: 750 * 12, usd: 790, label: 'Studio plan (yearly)' },
  'addon:addon_small':   { kind: 'addon', credits: 100, usd: 8,  label: '100 credit pack' },
  'addon:addon_large':   { kind: 'addon', credits: 500, usd: 30, label: '500 credit pack' },
};
