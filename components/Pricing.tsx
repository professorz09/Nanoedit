import React, { useLayoutEffect, useRef, useState } from 'react';
import { PLANS, ADDONS, perMonth, priceFor, yearlySavingPct, PLAN_RANK, PlanId, BillingCycle, Plan, TRIAL_CREDITS } from '../services/plans';
import { useAuth } from '../contexts/AuthContext';

// a thin check, like the list on higgsfield.ai's pricing cards
const Tick = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 mt-[3px] text-thumb-sub"><path d="M20 6 9 17l-5-5" /></svg>);

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
  // user-reported ("dabne se kuch nahi hota"): a checkout that couldn't start put its error in the thumbnail
  // panel's note, which isn't on this page — so nothing showed. It shows here now.
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      await onCheckout(plan, cycle);
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleAddon = async (addonId: string) => {
    if (!user) { onRequireLogin(); return; }
    if (busy) return;
    setBusy(`addon:${addonId}`);
    setError(null);
    try {
      await onBuyAddon(addonId);
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="pt-10 pb-16">
      <style>{'@keyframes prIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}'}</style>
      {/* Billing cycle toggle — one pill slides under the picked option: red for Monthly, green for Yearly (the
          saving; user-requested) */}
      <div className="flex items-center justify-center">
        <div className="relative flex items-center p-1.5 bg-black/50 border border-white/[0.08] rounded-full shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]">
          <span
            aria-hidden="true"
            className={`absolute top-1.5 bottom-1.5 rounded-full ${cycle === 'yearly' ? 'price-pill-green' : 'price-pill-red'}`}
            style={{ left: pill.left, width: pill.width, transition: 'left .35s cubic-bezier(.3,1.3,.5,1), width .35s cubic-bezier(.3,1.3,.5,1), background .3s ease, box-shadow .3s ease' }}
          />
          {(['monthly', 'yearly'] as const).map(c => (
            <button
              key={c}
              ref={el => { tabRefs.current[c] = el; }}
              onClick={() => setCycle(c)}
              disabled={busy !== null}
              aria-pressed={cycle === c}
              className={`relative z-10 h-11 px-5 rounded-full text-[15px] font-bold flex items-center gap-2 whitespace-nowrap disabled:opacity-60 transition-colors duration-300 ${cycle === c ? (c === 'yearly' ? 'text-[#04140d]' : 'text-white') : 'text-thumb-sub hover:text-thumb-ink'}`}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
              {c === 'yearly' && (
                <span className={`shrink-0 text-[10px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap transition-colors duration-300 ${cycle === 'yearly' ? 'bg-black/80 text-thumb-green' : 'text-thumb-green bg-thumb-greenSoft border border-thumb-green/30'}`}>2 months free</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="max-w-xl mx-auto mt-5 px-4 py-3 rounded-2xl bg-thumb-redSoft border border-thumb-red/30 text-[13.5px] text-red-300 flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Close" className="shrink-0 text-red-300/70 hover:text-red-200 font-bold">✕</button>
        </div>
      )}

      {/* Plan cards (user-requested: bold like higgsfield.ai's — the heading lines above them are gone). On a phone
          the popular plan comes first; each card: big name + badge, the price (the monthly one struck through
          when paying yearly), what's in it in its own box, one full-width button. */}
      <div className="grid md:grid-cols-3 gap-4 lg:gap-5 max-w-5xl mx-auto mt-8 px-1 items-stretch">
        {/* Free */}
        <div className="price-card rounded-[30px] p-6 sm:p-7 flex flex-col">
          <h3 className="text-[30px] leading-none font-black uppercase tracking-[-0.02em] text-thumb-ink">Free</h3>
          <p className="text-[14px] text-thumb-sub mt-2.5">Try it on your own video</p>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-[44px] leading-none font-black tracking-[-0.03em] text-thumb-ink">$0</span>
            <span className="text-[14px] text-thumb-sub">no card needed</span>
          </div>
          <ul className="price-box mt-5 rounded-2xl px-4 py-3.5 space-y-2.5 flex-1">
            {[`${TRIAL_CREDITS} free Short when you sign up`, 'Viral score for every moment', 'All styles, captions & effects', 'Standard (slower) generation'].map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[14px] text-thumb-ink/90"><Tick /> {f}</li>
            ))}
          </ul>
          <button
            onClick={() => (user ? onStartFree?.() : onRequireLogin())}
            className="price-cta-plain mt-5 w-full h-14 rounded-2xl font-bold text-[16px]"
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
          const yearly = cycle === 'yearly';
          return (
            <div key={plan.id} className={`price-card rounded-[30px] p-6 sm:p-7 flex flex-col ${plan.highlight ? 'price-card-hot order-first md:order-none' : ''}`}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[30px] leading-none font-black uppercase tracking-[-0.02em] text-thumb-ink">{plan.name}</h3>
                {yearly
                  ? <span className="price-badge price-badge-green">{yearlySavingPct(plan)}% off</span>
                  : plan.highlight && <span className="price-badge">Most popular</span>}
              </div>
              <p className="text-[14px] text-thumb-sub mt-2.5">{plan.tagline}</p>
              <div className="mt-5 flex items-baseline gap-2 flex-wrap">
                {yearly && <span className="text-[30px] leading-none font-black tracking-[-0.03em] text-thumb-sub/50 line-through">${plan.monthly.priceUsd}</span>}
                <span key={cycle} className={`text-[44px] leading-none font-black tracking-[-0.03em] inline-block ${yearly ? 'text-thumb-green' : 'text-thumb-ink'}`} style={{ animation: 'prIn .35s ease-out both' }}>${perMonth(plan, cycle)}</span>
                <span className="text-[14px] text-thumb-sub">/mo, {yearly ? `billed $${opt.priceUsd} yearly` : 'billed monthly'}</span>
              </div>
              <ul className="price-box mt-5 rounded-2xl px-4 py-3.5 space-y-2.5 flex-1">
                <li className="flex items-start gap-2.5 text-[14px] text-thumb-ink"><Tick /> <span><b>{plan.credits} credits/mo.</b> <span className="text-thumb-sub">≈ ${perShort} a Short</span></span></li>
                {plan.features.filter(f => !/credits \/ month|^Up to \d+ Shorts/.test(f)).map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-[14px] text-thumb-ink/90"><Tick /> {f}</li>
                ))}
              </ul>
              <button
                onClick={() => handlePick(plan)}
                disabled={isCurrent || isDowngrade || busy !== null}
                title={isDowngrade ? `You're already on a bigger plan — this would reset your credits down, so it's blocked. Buy add-on credits instead if you need more.` : undefined}
                className={`mt-5 w-full h-14 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 disabled:cursor-default ${
                  isCurrent || isDowngrade ? 'price-cta-done' : plan.highlight ? 'price-cta-hot' : 'price-cta-plain'
                }`}
              >
                {isCurrent
                  ? 'Current plan'
                  : isDowngrade
                    ? 'Included in your plan'
                    : busy === `plan:${plan.id}`
                      ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing…</>
                      : <>Get {plan.name}{yearly ? ' yearly' : ''}</>}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[12px] text-thumb-sub mt-5">A Short that fails to render doesn't cost a credit.</p>

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
