import React, { useState } from 'react';
import { PLANS, ADDONS, perMonth, priceFor, yearlySavingPct, BillingCycle, Plan } from '../services/plans';
import { useAuth } from '../contexts/AuthContext';

const Check = (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z" /></svg>);
const Wand = (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>);

interface Props {
  onCheckout: (plan: Plan, cycle: BillingCycle) => void;
  onBuyAddon: (addonId: string) => void;
  onRequireLogin: () => void;
}

const Pricing: React.FC<Props> = ({ onCheckout, onBuyAddon, onRequireLogin }) => {
  const { user, profile } = useAuth();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  // Add-on credit packs are only for paying subscribers (Pro / Studio).
  // Free users must pick a plan first — top-ups aren't offered to them.
  const hasPaidPlan = profile?.plan === 'pro' || profile?.plan === 'studio';

  const handlePick = (plan: Plan) => {
    if (!user) { onRequireLogin(); return; }
    onCheckout(plan, cycle);
  };

  return (
    <section className="pt-10 pb-16">
      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-1 p-1.5 bg-thumb-soft border border-thumb-line rounded-2xl flex-wrap justify-center">
          <button
            onClick={() => setCycle('monthly')}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${cycle === 'monthly' ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setCycle('yearly')}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${cycle === 'yearly' ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}
          >
            Yearly
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-thumb-green bg-thumb-greenSoft border border-thumb-green/30 rounded-full px-1.5 py-0.5 whitespace-nowrap">2 months free</span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid sm:grid-cols-2 gap-5 lg:gap-6 max-w-3xl mx-auto mt-9 px-1">
        {PLANS.map(plan => {
          const isCurrent = profile?.plan === plan.id;
          const opt = priceFor(plan, cycle);
          return (
            <div
              key={plan.id}
              className={`thumb-glass rounded-3xl p-6 sm:p-7 flex flex-col relative ${plan.highlight ? 'thumb-float-red ring-1 ring-thumb-red/40' : ''}`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-black uppercase tracking-wider bg-thumb-red text-white px-3 py-1 rounded-full shadow">Most popular</span>
              )}
              <h3 className="text-xl font-black text-thumb-ink">{plan.name}</h3>
              <div className="mt-3 flex items-end gap-1.5">
                <span className="text-4xl font-black text-thumb-ink">${perMonth(plan, cycle)}</span>
                <span className="text-sm text-thumb-sub mb-1.5">/ month</span>
              </div>
              <p className="text-xs text-thumb-sub mt-1 h-4">
                {cycle === 'yearly' ? `Billed $${opt.priceUsd}/year · save ${yearlySavingPct(plan)}%` : 'Billed monthly'}
              </p>

              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-thumb-ink">
                    <Check className="w-4 h-4 text-thumb-green shrink-0 mt-0.5" /> {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handlePick(plan)}
                disabled={isCurrent}
                className={`mt-6 w-full py-3.5 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-all ${
                  isCurrent
                    ? 'bg-thumb-soft border border-thumb-line text-thumb-sub cursor-default'
                    : 'thumb-btn text-white'
                }`}
              >
                {isCurrent ? 'Current plan' : <><Wand className="w-4 h-4" /> Get {plan.name}</>}
              </button>
            </div>
          );
        })}
      </div>

      {/* Add-on credit packs — paid plans only */}
      {hasPaidPlan && (
      <div className="max-w-3xl mx-auto mt-10 px-1">
        <div className="thumb-glass rounded-3xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-black text-lg text-thumb-ink">Need more credits?</h3>
              <p className="text-sm text-thumb-sub mt-0.5">One-time top-ups on any plan. They never expire.</p>
            </div>
            <div className="flex gap-2.5">
              {ADDONS.map(a => (
                <button
                  key={a.id}
                  onClick={() => (user ? onBuyAddon(a.id) : onRequireLogin())}
                  className="px-4 py-2.5 rounded-2xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 text-thumb-ink font-bold text-sm transition-colors"
                >
                  +{a.credits} <span className="text-thumb-sub font-semibold">· ${a.priceUsd}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </section>
  );
};

export default Pricing;
