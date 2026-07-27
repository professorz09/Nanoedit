// ── Pricing config (single source of truth) ──────────────────────────
// Edit prices/credits here; UI + Stripe checkout both read from this.
export type PlanId = 'free' | 'pro' | 'studio';
export type BillingCycle = 'monthly' | 'yearly';

export interface PriceOption {
  priceUsd: number;  // monthly cycle: per month.  yearly cycle: total per YEAR.
  priceEnv: string;  // .env key holding the matching Stripe Price ID (server-side)
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

// New users start on a small trial (5 credits) so they can try before buying.
// The trial is an internal state, NOT a purchasable card.
export const TRIAL_CREDITS = 5;

// The two purchasable plans. Yearly = 10× the monthly price (2 months free).
export const PLANS: Plan[] = [
  {
    id: 'pro',
    name: 'Pro',
    credits: 400,
    monthly: { priceUsd: 39, priceEnv: 'STRIPE_PRICE_PRO_MONTHLY' },
    yearly:  { priceUsd: 390, priceEnv: 'STRIPE_PRICE_PRO_YEARLY' },
    highlight: true,
    features: ['400 thumbnails / month', 'HD 16:9 output', 'All styles & templates', 'Priority generation'],
  },
  {
    id: 'studio',
    name: 'Studio',
    credits: 1500,
    monthly: { priceUsd: 79, priceEnv: 'STRIPE_PRICE_STUDIO_MONTHLY' },
    yearly:  { priceUsd: 790, priceEnv: 'STRIPE_PRICE_STUDIO_YEARLY' },
    features: ['1500 thumbnails / month', '4K max quality', 'Fastest queue', 'Everything in Pro'],
  },
];

// One-time add-on credit packs (bought on top of any subscription; never expire)
export interface AddonPack {
  id: string;
  credits: number;
  priceUsd: number;
  priceEnv: string;
}

export const ADDONS: AddonPack[] = [
  { id: 'addon_small', credits: 100, priceUsd: 8,  priceEnv: 'STRIPE_PRICE_ADDON_SMALL' },
  { id: 'addon_large', credits: 500, priceUsd: 30, priceEnv: 'STRIPE_PRICE_ADDON_LARGE' },
];

export const getPlan = (id: PlanId): Plan | undefined => PLANS.find(p => p.id === id);

// Helpers for the UI
export const priceFor = (plan: Plan, cycle: BillingCycle) =>
  cycle === 'monthly' ? plan.monthly : plan.yearly;

// Effective $/month for display (yearly total ÷ 12)
export const perMonth = (plan: Plan, cycle: BillingCycle) =>
  cycle === 'monthly' ? plan.monthly.priceUsd : Math.round((plan.yearly.priceUsd / 12) * 100) / 100;

// % saved by paying yearly vs 12 monthly payments
export const yearlySavingPct = (plan: Plan) =>
  Math.round((1 - plan.yearly.priceUsd / (plan.monthly.priceUsd * 12)) * 100);
