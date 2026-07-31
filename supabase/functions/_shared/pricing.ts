// ═══════════════════════════════════════════════════════════════════════════
// Shared purchase catalog — the SERVER-SIDE source of truth for what each item
// costs and how many credits it grants. The browser only ever sends an item id
// (e.g. "plan:pro:monthly"); the amount is computed here so a client can never
// tamper with the price it's charged.
//
// Prices in services/plans.ts are USD (display). Razorpay test accounts are
// INR-only, so we charge in INR: amount = round(USD × USD_TO_INR) rupees.
// Change USD_TO_INR (or the per-item usd) here and both order-creation and
// crediting stay in sync. Imported by create-order + verify-payment.
// ═══════════════════════════════════════════════════════════════════════════
export const USD_TO_INR = 84;

export interface CatalogItem {
  kind: 'plan' | 'addon';
  credits: number;
  usd: number;
  plan?: 'pro' | 'studio';      // set for kind:'plan'
  cycle?: 'monthly' | 'yearly'; // set for kind:'plan'
  label: string;
}

export const CATALOG: Record<string, CatalogItem> = {
  'plan:pro:monthly':    { kind: 'plan',  plan: 'pro',    cycle: 'monthly', credits: 200, usd: 39,  label: 'Pro plan (monthly)' },
  'plan:pro:yearly':     { kind: 'plan',  plan: 'pro',    cycle: 'yearly',  credits: 200, usd: 390, label: 'Pro plan (yearly)' },
  'plan:studio:monthly': { kind: 'plan',  plan: 'studio', cycle: 'monthly', credits: 750, usd: 79,  label: 'Studio plan (monthly)' },
  'plan:studio:yearly':  { kind: 'plan',  plan: 'studio', cycle: 'yearly',  credits: 750, usd: 790, label: 'Studio plan (yearly)' },
  'addon:addon_small':   { kind: 'addon', credits: 100, usd: 8,  label: '100 credit pack' },
  'addon:addon_large':   { kind: 'addon', credits: 500, usd: 30, label: '500 credit pack' },
};

// Smallest currency unit (paise). Razorpay requires amount ≥ 100 (₹1).
export const inrPaise = (usd: number): number => Math.round(usd * USD_TO_INR) * 100;

export const CURRENCY = 'INR';
