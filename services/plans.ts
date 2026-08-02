// ── Pricing config (DISPLAY only) ──────────────────────────
// Edit prices/credits here for the UI. The amount actually charged is
// computed server-side by the matching catalog entry in
// supabase/functions/_shared/pricing.ts (Dodo Payments checkout creation +
// webhook crediting) — keep the two in sync when changing a price or credit
// amount, since the client here is never trusted for the charged amount.
export type PlanId = 'free' | 'pro' | 'studio';
export type BillingCycle = 'monthly' | 'yearly';

export interface PriceOption {
  priceUsd: number;  // monthly cycle: per month.  yearly cycle: total per YEAR.
}

export interface Plan {
  id: PlanId;
  name: string;
  credits: number;            // thumbnails per month (same on both cycles)
  monthly: PriceOption;
  yearly: PriceOption;        // billed once a year (~2 months free)
  features: string[];
  highlight?: boolean;
}

// New (free) users get ZERO credits — they must buy a plan before generating.
// Kept as a named constant so the signup trigger + UI stay in sync.
export const TRIAL_CREDITS = 0;

// The two purchasable plans. Yearly = 10× the monthly price (2 months free).
export const PLANS: Plan[] = [
  {
    id: 'pro',
    name: 'Pro',
    credits: 130,
    monthly: { priceUsd: 39 },
    yearly:  { priceUsd: 390 },
    highlight: true,
    features: ['130 thumbnails / month', 'HD 16:9 output', 'All styles & templates', 'Priority generation'],
  },
  {
    id: 'studio',
    name: 'Studio',
    credits: 400,
    monthly: { priceUsd: 79 },
    yearly:  { priceUsd: 790 },
    features: ['400 thumbnails / month', '4K max quality', 'Fastest queue', 'Everything in Pro'],
  },
];

// One-time add-on credit packs (bought on top of any subscription; never expire)
export interface AddonPack {
  id: string;
  credits: number;
  priceUsd: number;
}

// TEMPORARY — addon_small repriced to $1 (was 10) for live-payment
// verification, matching supabase/functions/_shared/pricing.ts. Revert both
// together right after testing.
export const ADDONS: AddonPack[] = [
  { id: 'addon_small', credits: 25, priceUsd: 1 },
  { id: 'addon_large', credits: 100, priceUsd: 35 },
];

export const getPlan = (id: PlanId): Plan | undefined => PLANS.find(p => p.id === id);

// Tier ordering — used to block buying a LOWER (or equal — "Current plan"
// already covers equal) plan than the one a user actively holds, since a
// purchase there would otherwise silently downgrade their credits.
export const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, studio: 2 };

// Helpers for the UI
export const priceFor = (plan: Plan, cycle: BillingCycle) =>
  cycle === 'monthly' ? plan.monthly : plan.yearly;

// Effective $/month for display (yearly total ÷ 12)
export const perMonth = (plan: Plan, cycle: BillingCycle) =>
  cycle === 'monthly' ? plan.monthly.priceUsd : Math.round((plan.yearly.priceUsd / 12) * 100) / 100;

// % saved by paying yearly vs 12 monthly payments
export const yearlySavingPct = (plan: Plan) =>
  Math.round((1 - plan.yearly.priceUsd / (plan.monthly.priceUsd * 12)) * 100);
