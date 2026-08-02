import { supabase } from './supabase';

interface CheckoutResponse {
  checkout_url: string;
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

// create-checkout is a single idempotent-enough GET-like operation (it just
// asks Lemon Squeezy to mint a fresh checkout — retrying on a transient
// failure costs nothing but a redundant, unused session).
const authedFetchWithRetry = async (path: string, body: unknown) => {
  try {
    return await authedFetch(path, body);
  } catch (e: any) {
    if (!e?.retryable) throw e;
    return authedFetch(path, body);
  }
};

/**
 * Buys a catalog item (a plan cycle or an add-on pack) via Lemon Squeezy:
 * creates a server-side checkout, then navigates the browser to Lemon
 * Squeezy's hosted checkout page. There is no client-side "success"
 * callback — Lemon Squeezy redirects back to the app's return_url once the
 * customer finishes checkout, and the actual credit grant happens
 * server-side via the "lemonsqueezy-webhook" Edge Function once Lemon
 * Squeezy confirms the order.
 */
export const buyItem = async (itemId: string): Promise<void> => {
  const session = await authedFetchWithRetry('create-checkout', { item: itemId }) as CheckoutResponse;
  if (!session?.checkout_url) throw new Error('Could not start checkout. Please try again.');
  window.location.href = session.checkout_url;
};
