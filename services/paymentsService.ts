import { supabase } from './supabase';

// Loads the Razorpay Checkout script once and reuses it on repeat calls.
let razorpayScriptPromise: Promise<void> | null = null;
const loadRazorpayScript = (): Promise<void> => {
  if ((window as any).Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => { razorpayScriptPromise = null; reject(new Error('Could not load the payment provider.')); };
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
};

interface OrderResponse {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  label: string;
}

const authedFetch = async (path: string, body: unknown) => {
  if (!supabase) throw new Error('Please sign in to continue.');
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl) throw new Error('Payments are not configured. Please contact support.');

  // getSession() can itself throw (corrupted/expired local session, a network
  // blip refreshing the token) instead of just returning a null session —
  // left unguarded, that raw library error leaked straight into the
  // checkout's error toast instead of a clean, actionable message.
  let token: string | undefined;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  } catch {
    throw new Error('Please sign in to continue.');
  }
  if (!token) throw new Error('Please sign in to continue.');

  const resp = await fetch(`${supaUrl}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: supaAnon ?? '',
    },
    body: JSON.stringify(body),
  });
  // A bare non-2xx with no parseable JSON body (edge-function cold-start
  // timeout, gateway hiccup) is exactly what produced the unhelpful
  // "Something went wrong" — tag it as retryable so the caller below can
  // transparently retry once instead of surfacing it immediately.
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (!data) { const err: any = new Error('Could not reach the server. Please try again.'); err.retryable = true; throw err; }
    throw new Error(data?.error || 'Something went wrong. Please try again.');
  }
  return data;
};

// create-order is a single idempotent-enough GET-like operation (it just asks
// Razorpay to mint a fresh order — retrying on a transient failure costs
// nothing but a redundant, unused order). One retry covers the same class of
// transient blips verify-payment already retries for.
const authedFetchWithRetry = async (path: string, body: unknown) => {
  try {
    return await authedFetch(path, body);
  } catch (e: any) {
    if (!e?.retryable) throw e;
    return authedFetch(path, body);
  }
};

/**
 * Buys a catalog item (a plan cycle or an add-on pack) via Razorpay Standard
 * Checkout: creates a server-side order, opens the Razorpay modal, then
 * verifies the payment server-side (which grants the credits/plan). Resolves
 * once the purchase is confirmed and credited; rejects if cancelled or failed.
 */
export const buyItem = async (itemId: string): Promise<void> => {
  const order = await authedFetchWithRetry('create-order', { item: itemId }) as OrderResponse;
  await loadRazorpayScript();

  return new Promise((resolve, reject) => {
    const rz = new (window as any).Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: 'PodcastFlux',
      description: order.label,
      handler: async (resp: any) => {
        const payload = {
          razorpay_order_id: resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature: resp.razorpay_signature,
        };
        try {
          // verify-payment is idempotent (claims the ledger row before
          // crediting), so a single retry safely covers a transient failure
          // right after a successful charge — the money already moved.
          try {
            await authedFetch('verify-payment', payload);
          } catch {
            await authedFetch('verify-payment', payload);
          }
          resolve();
        } catch (e: any) {
          reject(new Error(`${e?.message || 'Verification failed.'} Payment reference: ${resp.razorpay_payment_id}`));
        }
      },
      modal: { ondismiss: () => reject(new Error('cancelled')) },
      theme: { color: '#e63946' },
    });
    rz.on('payment.failed', () => reject(new Error('Payment failed. Please try again.')));
    rz.open();
  });
};
