// ═══════════════════════════════════════════════════════════════════════════
// Shared purchase catalog — the SERVER-SIDE source of truth for what each item
// costs and how many credits it grants. The browser only ever sends an item id
// (e.g. "plan:pro:monthly"); the amount is computed here so a client can never
// tamper with the price it's charged.
//
// Billed via Dodo Payments (merchant of record) in USD — `usd` here is the
// exact amount charged, no currency conversion needed. Imported by
// create-checkout + dodo-webhook.
// ═══════════════════════════════════════════════════════════════════════════

// The single "Pay What You Want" one-time-payment product created in the Dodo
// dashboard — every purchase uses this same product, with the actual price
// set per-request via create-checkout (see docs: dynamic pricing checkout).
// LIVE-mode product id (test and live are separate catalogs — this only
// works together with DODO_PAYMENTS_ENVIRONMENT=live_mode + a live API key).
export const DODO_PRODUCT_ID = 'pdt_0NkSA7Ixv4HewZQhStCHM';

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
// (services/plans.ts advertises "130 thumbnails / month" regardless of
// cycle), which they'd burn through immediately.
export const CATALOG: Record<string, CatalogItem> = {
  'plan:pro:monthly':    { kind: 'plan',  plan: 'pro',    cycle: 'monthly', credits: 130,      usd: 39,  label: 'Pro plan (monthly)' },
  'plan:pro:yearly':     { kind: 'plan',  plan: 'pro',    cycle: 'yearly',  credits: 130 * 12, usd: 390, label: 'Pro plan (yearly)' },
  'plan:studio:monthly': { kind: 'plan',  plan: 'studio', cycle: 'monthly', credits: 400,      usd: 79,  label: 'Studio plan (monthly)' },
  'plan:studio:yearly':  { kind: 'plan',  plan: 'studio', cycle: 'yearly',  credits: 400 * 12, usd: 790, label: 'Studio plan (yearly)' },
  'addon:addon_small':   { kind: 'addon', credits: 25,  usd: 10, label: '25 credit pack' },
  'addon:addon_large':   { kind: 'addon', credits: 100, usd: 35, label: '100 credit pack' },
  // TEMPORARY — one-off $1 item for verifying the live Dodo integration
  // end-to-end (real checkout → real charge → real webhook → credit grant)
  // without spending a real plan's worth of money. Not listed in
  // services/plans.ts, so it never appears in the normal Pricing UI — only
  // reachable via the admin-only button in ThumbnailStudio's Pricing
  // section. Remove this entry (and that button) once verified.
  'plan:pro:monthly_livetest': { kind: 'plan', plan: 'pro', cycle: 'monthly', credits: 1, usd: 1, label: 'Live verification (temporary)' },
};

// Tier ordering — a plan purchase resets `profiles.credits` to the new
// plan's allotment (see dodo-webhook), so buying a lower tier than the one
// already active would silently wipe out unused credits. create-checkout
// uses this to reject that server-side (the UI already hides/disables it,
// but a direct API call could otherwise skip straight past that).
export const PLAN_RANK: Record<'free' | 'pro' | 'studio', number> = { free: 0, pro: 1, studio: 2 };
