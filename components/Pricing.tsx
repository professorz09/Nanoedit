import React, { useLayoutEffect, useRef, useState } from 'react';
import { PLANS, ADDONS, perMonth, priceFor, yearlySavingPct, PLAN_RANK, PlanId, BillingCycle, Plan, TRIAL_CREDITS } from '../services/plans';
import { useAuth } from '../contexts/AuthContext';

const Check = (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z" /></svg>);
const Wand = (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>);

interface Props {
  onCheckout: (plan: Plan, cycle: BillingCycle) => Promise<void>;
  onBuyAddon: (addonId: string) => Promise<void>;
  onRequireLogin: () => void;
  onStartFree?: () => void;
}

const Pricing: React.FC<Props> = ({ onCheckout, onBuyAddon, onRequireLogin, onStartFree }) => {
  const { user, profile } = useAuth();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  // Only one checkout can be in flight — 'plan:<id>' | 'addon:<id>' | null.
  // Also doubles as the click guard: without it, a click that doesn't
  // visibly react in the ~1s it takes to create the checkout session reads
  // as "nothing happened," so an impatient second click fires a second
  // session and often surfaces as a confusing "Something went wrong."
  const [busy, setBusy] = useState<string | null>(null);
  // the sliding pill under the Monthly / Yearly toggle: measured from the picked button
  const tabRefs = useRef<Record<BillingCycle, HTMLButtonElement | null>>({ monthly: null, yearly: null });
  const [pill, setPill] = useState({ left: 6, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current[cycle];
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [cycle]);

  // Add-on credit packs are only for paying subscribers (Pro / Studio).
  // Free users must pick a plan first — top-ups aren't offered to them.
  const hasPaidPlan = profile?.plan === 'pro' || profile?.plan === 'studio';
  const currentRank = PLAN_RANK[(profile?.plan as PlanId) ?? 'free'] ?? 0;

  const handlePick = async (plan: Plan) => {
    if (!user) { onRequireLogin(); return; }
    if (busy) return;
    setBusy(`plan:${plan.id}`);
    try {
      await onCheckout(plan, cycle);
    } finally {
      setBusy(null);
    }
  };

  const handleAddon = async (addonId: string) => {
    if (!user) { onRequireLogin(); return; }
    if (busy) return;
    setBusy(`addon:${addonId}`);
    try {
      await onBuyAddon(addonId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="pt-10 pb-16">
      <style>{'@keyframes prIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}'}</style>
      {/* Billing cycle toggle — one red pill that slides under the picked option */}
      <div className="flex items-center justify-center">
        <div className="relative flex items-center p-1.5 bg-thumb-soft border border-thumb-line rounded-2xl">
          <span
            aria-hidden="true"
            className="thumb-liquid absolute top-1.5 bottom-1.5 rounded-xl"
            style={{ left: pill.left, width: pill.width, transition: 'left .35s cubic-bezier(.3,1.3,.5,1), width .35s cubic-bezier(.3,1.3,.5,1)' }}
          />
          {(['monthly', 'yearly'] as const).map(c => (
            <button
              key={c}
              ref={el => { tabRefs.current[c] = el; }}
              onClick={() => setCycle(c)}
              disabled={busy !== null}
              aria-pressed={cycle === c}
              className={`relative z-10 px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap disabled:opacity-60 transition-colors duration-300 ${cycle === c ? 'text-white' : 'text-thumb-sub hover:text-thumb-ink'}`}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
              {c === 'yearly' && (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-thumb-green bg-thumb-greenSoft border border-thumb-green/30 rounded-full px-1.5 py-0.5 whitespace-nowrap">2 months free</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="text-center mt-8">
        <h2 className="text-[28px] sm:text-[40px] font-black tracking-[-0.02em] text-thumb-ink leading-tight">Simple pricing. <span className="text-thumb-red">1 credit = 1 Short.</span></h2>
        <p className="text-thumb-sub mt-2 text-[15px]">1 credit finds the Shorts in a video (back if none are found) — then a credit for each Short you download.</p>
      </div>

      {/* Plan cards: Free, then the two paid plans */}
      <div className="grid md:grid-cols-3 gap-5 lg:gap-6 max-w-5xl mx-auto mt-9 px-1 items-stretch">
        {/* Free */}
        <div className="thumb-glass rounded-3xl p-6 sm:p-7 flex flex-col relative">
          <h3 className="text-xl font-black text-thumb-ink">Free</h3>
          <p className="text-[13px] text-thumb-sub mt-1 min-h-[20px]">Try it on your own video</p>
          <div className="mt-4 flex items-end gap-1.5">
            <span className="text-5xl font-black text-thumb-ink tracking-tight">$0</span>
          </div>
          <p className="text-xs text-thumb-sub mt-1.5 h-4">No card needed</p>
          <div className="mt-5 rounded-2xl bg-thumb-soft border border-thumb-line px-4 py-3">
            <p className="text-[22px] font-black text-thumb-ink leading-none">{TRIAL_CREDITS} Short</p>
            <p className="text-[12px] text-thumb-sub mt-1">free when you sign up</p>
          </div>
          <ul className="mt-5 space-y-2.5 flex-1">
            {['Preview all the best moments', 'Viral score for each one', 'All styles, captions & effects', 'Standard (slower) generation'].map(f => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-thumb-ink"><Check className="w-4 h-4 text-thumb-green shrink-0 mt-0.5" /> {f}</li>
            ))}
          </ul>
          <button
            onClick={() => (user ? onStartFree?.() : onRequireLogin())}
            className="mt-6 w-full py-3.5 rounded-2xl font-bold text-[15px] bg-thumb-soft border border-thumb-line text-thumb-ink hover:border-thumb-red/50 transition-colors"
          >
            {user ? (profile?.plan === 'free' ? 'Make my free Short' : 'Open Shorts Maker') : 'Start free'}
          </button>
        </div>

        {PLANS.map(plan => {
          const isCurrent = profile?.plan === plan.id;
          // A plan buy always resets credits to the purchased plan's
          // allotment (see dodo-webhook) — buying a lower tier while a
          // higher one is active would silently wipe out unused credits, so
          // block it here instead of letting it through as a real purchase.
          const isDowngrade = !isCurrent && PLAN_RANK[plan.id] < currentRank;
          const opt = priceFor(plan, cycle);
          const perShort = (perMonth(plan, cycle) / plan.credits).toFixed(2);
          return (
            <div
              key={plan.id}
              className={`thumb-glass rounded-3xl p-6 sm:p-7 flex flex-col relative ${plan.highlight ? 'thumb-float-red ring-2 ring-thumb-red/60 md:-translate-y-2' : ''}`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-black uppercase tracking-wider bg-thumb-red text-white px-3 py-1 rounded-full shadow whitespace-nowrap">Most popular</span>
              )}
              <h3 className="text-xl font-black text-thumb-ink">{plan.name}</h3>
              <p className="text-[13px] text-thumb-sub mt-1 min-h-[20px]">{plan.tagline}</p>
              <div className="mt-4 flex items-end gap-1.5">
                <span key={cycle} className="text-5xl font-black text-thumb-ink tracking-tight inline-block" style={{ animation: 'prIn .35s ease-out both' }}>${perMonth(plan, cycle)}</span>
                <span className="text-sm text-thumb-sub mb-2">/ month</span>
              </div>
              <p className="text-xs text-thumb-sub mt-1.5 h-4">
                {cycle === 'yearly' ? `Billed $${opt.priceUsd}/year · save ${yearlySavingPct(plan)}%` : 'Billed monthly · one-time payment'}
              </p>
              <div className={`mt-5 rounded-2xl px-4 py-3 border ${plan.highlight ? 'bg-thumb-redSoft border-thumb-red/25' : 'bg-thumb-soft border-thumb-line'}`}>
                <p className="text-[22px] font-black text-thumb-ink leading-none">{plan.credits} Shorts <span className="text-[13px] font-bold text-thumb-sub">/ month</span></p>
                <p className="text-[12px] text-thumb-sub mt-1">≈ ${perShort} per Short</p>
              </div>

              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.filter(f => !/credits \/ month|^Up to \d+ Shorts/.test(f)).map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-thumb-ink">
                    <Check className="w-4 h-4 text-thumb-green shrink-0 mt-0.5" /> {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handlePick(plan)}
                disabled={isCurrent || isDowngrade || busy !== null}
                title={isDowngrade ? `You're already on a bigger plan — this would reset your credits down, so it's blocked. Buy add-on credits instead if you need more.` : undefined}
                className={`mt-6 w-full py-3.5 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-all disabled:opacity-60 ${
                  isCurrent || isDowngrade
                    ? 'bg-thumb-soft border border-thumb-line text-thumb-sub cursor-default'
                    : plan.highlight ? 'thumb-btn text-white' : 'border-2 border-thumb-red text-thumb-red hover:bg-thumb-redSoft'
                }`}
              >
                {isCurrent
                  ? 'Current plan'
                  : isDowngrade
                    ? 'Included in your plan'
                    : busy === `plan:${plan.id}`
                      ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing…</>
                      : <><Wand className="w-4 h-4" /> Get {plan.name}</>}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[12px] text-thumb-sub mt-6">A Short that fails to render doesn't cost a credit.</p>

      {/* Add-on credit packs — paid plans only */}
      {hasPaidPlan && (
      <div className="max-w-5xl mx-auto mt-10 px-1">
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
                  onClick={() => (user ? handleAddon(a.id) : onRequireLogin())}
                  disabled={busy !== null}
                  aria-label={busy === `addon:${a.id}` ? `Processing ${a.credits} credits` : undefined}
                  aria-busy={busy === `addon:${a.id}`}
                  className="px-4 py-2.5 rounded-2xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 text-thumb-ink font-bold text-sm transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {busy === `addon:${a.id}`
                    ? <><span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing…</>
                    : <>+{a.credits} <span className="text-thumb-sub font-semibold">· ${a.priceUsd}</span></>}
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
