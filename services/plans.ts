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
  credits: number;            // credits per month (1 credit = 1 Short; a thumbnail is 1–5, see supabase/functions/generate IMAGE_COST)
  tagline: string;
  monthly: PriceOption;
  yearly: PriceOption;        // billed once a year (~2 months free)
  features: string[];
  highlight?: boolean;
}

// New (free) users get enough credits for ONE Short (user-decided) — the signup trigger
// (supabase/migrations/0022_free_one_short.sql) grants the same number.
export const TRIAL_CREDITS = 1;

// The two purchasable plans. Yearly = 10× the monthly price (2 months free).
export const PLANS: Plan[] = [
  // ids stay 'pro' / 'studio' (stored on profiles and in past purchases); only the names shown changed
  {
    id: 'pro',
    name: 'Starter',
    tagline: 'For creators posting a few Shorts a week',
    credits: 100,
    monthly: { priceUsd: 29 },
    yearly:  { priceUsd: 290 },
    highlight: true,
    features: ['100 credits / month', 'Up to 100 Shorts', 'Viral score for every moment', 'Bulk: up to 20 Shorts from one link', 'All styles, captions & effects', 'Standard (slower) generation'],
  },
  {
    id: 'studio',
    name: 'Creator',
    tagline: 'For podcasts and daily posting',
    credits: 400,
    monthly: { priceUsd: 79 },
    yearly:  { priceUsd: 790 },
    features: ['400 credits / month', 'Up to 400 Shorts', '⚡ Priority generation — your Shorts are made first', 'Everything in Starter', 'HD & 4K thumbnails too'],
  },
];

// One-time add-on credit packs (bought on top of any subscription; never expire)
export interface AddonPack {
  id: string;
  credits: number;
  priceUsd: number;
}

export const ADDONS: AddonPack[] = [
  { id: 'addon_small', credits: 25, priceUsd: 10 },
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
