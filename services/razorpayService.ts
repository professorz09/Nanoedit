// ─────────────────────────────────────────────────────────────────────────────
// Razorpay Standard Web Checkout — client side.
//
// Mirrors the app's dev/prod split (see geminiService/textService):
//   • DEV  → the Vite middleware /api/create-order + /api/verify-payment
//   • PROD → the Supabase Edge Functions of the same name
//
// The KEY_SECRET NEVER touches this file. We only use the public KEY_ID, and we
// prefer the one the server returns from create-order (falling back to
// VITE_RAZORPAY_KEY_ID). Amounts are decided server-side from the item id.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase';

const DEV = import.meta.env.DEV;
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPA_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const PUBLIC_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

const endpoint = (name: string) =>
  DEV ? `/api/${name}` : `${SUPA_URL}/functions/v1/${name}`;

export interface PayResult {
  ok: boolean;
  credits?: number;   // set on success
  cancelled?: boolean; // user dismissed the modal
  error?: string;
}

// Load checkout.js once, on demand (keeps it out of the initial bundle).
let sdkPromise: Promise<boolean> | null = null;
function loadCheckout(): Promise<boolean> {
  if ((window as any).Razorpay) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve(!!(window as any).Razorpay);
    s.onerror = () => { sdkPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

async function authedFetch(name: string, payload: unknown, token: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (!DEV && SUPA_ANON) headers.apikey = SUPA_ANON;
  const res = await fetch(endpoint(name), { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  return { res, data } as { res: Response; data: any };
}

/**
 * Runs the full checkout for a catalog item id (e.g. "plan:pro:monthly"):
 * create order → open modal → verify. Resolves once the flow settles — never
 * rejects — so callers can branch on { ok, cancelled, error }.
 */
export async function startPayment(item: string, prefill?: { email?: string }): Promise<PayResult> {
  if (!supabase) return { ok: false, error: 'Payments are not configured.' };

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: 'Please sign in to continue.' };

  // 1) Order.
  const { res, data: order } = await authedFetch('create-order', { item }, token);
  if (!res.ok || !order?.order_id) {
    return { ok: false, error: order?.error || 'Could not start checkout. Please try again.' };
  }

  // 2) SDK.
  const ready = await loadCheckout();
  if (!ready || !(window as any).Razorpay) {
    return { ok: false, error: 'Could not load the payment window. Check your connection and retry.' };
  }

  const keyId = order.key_id || PUBLIC_KEY_ID;
  if (!keyId) return { ok: false, error: 'Payments are not configured.' };

  // 3) Modal → verify. Resolve exactly once.
  return new Promise<PayResult>((resolve) => {
    let settled = false;
    const done = (r: PayResult) => { if (!settled) { settled = true; resolve(r); } };

    const rzp = new (window as any).Razorpay({
      key: keyId,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: 'PodcastFlux',
      description: order.label || 'Credits',
      prefill: prefill?.email ? { email: prefill.email } : undefined,
      theme: { color: '#ef4343' },
      modal: {
        ondismiss: () => done({ ok: false, cancelled: true }),
      },
      handler: async (resp: any) => {
        const { res: vr, data: vd } = await authedFetch('verify-payment', {
          razorpay_order_id: resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature: resp.razorpay_signature,
        }, token);
        if (vr.ok && vd?.ok) done({ ok: true, credits: vd.credits });
        else done({ ok: false, error: vd?.error || 'Payment verification failed. If you were charged, contact support.' });
      },
    });

    rzp.on('payment.failed', (resp: any) => {
      done({ ok: false, error: resp?.error?.description || 'Payment failed. Please try again.' });
    });

    rzp.open();
  });
}

// Convenience id builders so callers don't hand-assemble strings.
export const planItem = (plan: 'pro' | 'studio', cycle: 'monthly' | 'yearly') => `plan:${plan}:${cycle}`;
export const addonItem = (addonId: string) => `addon:${addonId}`;
