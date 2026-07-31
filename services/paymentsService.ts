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
  if (!supaUrl) throw new Error('Please sign in to continue.');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
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
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data;
};

/**
 * Buys a catalog item (a plan cycle or an add-on pack) via Razorpay Standard
 * Checkout: creates a server-side order, opens the Razorpay modal, then
 * verifies the payment server-side (which grants the credits/plan). Resolves
 * once the purchase is confirmed and credited; rejects if cancelled or failed.
 */
export const buyItem = async (itemId: string): Promise<void> => {
  const order = await authedFetch('create-order', { item: itemId }) as OrderResponse;
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
        try {
          await authedFetch('verify-payment', {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => reject(new Error('cancelled')) },
      theme: { color: '#e63946' },
    });
    rz.on('payment.failed', () => reject(new Error('Payment failed. Please try again.')));
    rz.open();
  });
};
