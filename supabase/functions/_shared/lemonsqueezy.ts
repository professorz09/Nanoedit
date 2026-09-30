// ═══════════════════════════════════════════════════════════════════════════
// Lemon Squeezy checkout (used by create-checkout). One product / variant in the LS dashboard; the
// price of each catalog item is set per checkout (custom_price), the same way Dodo's "pay what you
// want" product worked. The store is read from the variant, so only these two secrets are needed:
//   LEMONSQUEEZY_API_KEY     (Settings → API)
//   LEMONSQUEEZY_VARIANT_ID  (Products → … → Copy variant ID)
// Field names per the official @lemonsqueezy/lemonsqueezy.js types (JSON:API, snake_case on the wire).
// ═══════════════════════════════════════════════════════════════════════════
import type { CatalogItem } from './pricing.ts';

const API = 'https://api.lemonsqueezy.com/v1';
const headers = (key: string) => ({
  Accept: 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json',
  Authorization: `Bearer ${key}`,
});

let storeIdFor: { variant: string; store: string } | null = null;
const storeOf = async (key: string, variantId: string): Promise<string> => {
  if (storeIdFor?.variant === variantId) return storeIdFor.store;
  const resp = await fetch(`${API}/variants/${encodeURIComponent(variantId)}?include=product`, { headers: headers(key) });
  const data: any = await resp.json().catch(() => ({}));
  const product = (data?.included || []).find((x: any) => x?.type === 'products');
  const store = product?.attributes?.store_id;
  if (!resp.ok || !store) {
    console.error('ls_variant_lookup_failed', resp.status, JSON.stringify(data?.errors || data));
    throw new Error('Could not start checkout. Please try again.');
  }
  storeIdFor = { variant: variantId, store: String(store) };
  return storeIdFor.store;
};

export const lemonCheckout = async (opts: {
  apiKey: string; variantId: string; item: CatalogItem; itemId: string; uid: string;
  email?: string | null; name?: string | null; country?: string | null; appUrl: string;
}): Promise<string> => {
  const { apiKey, variantId, item, itemId, uid } = opts;
  const store = await storeOf(apiKey, variantId);
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        custom_price: Math.round(item.usd * 100),
        product_options: {
          name: item.label,
          description: `${item.credits} credits for Podcastflux`,
          redirect_url: `${opts.appUrl}/?ls_checkout=return&item=${encodeURIComponent(itemId)}`,
          receipt_button_text: 'Open Podcastflux',
          receipt_link_url: opts.appUrl,
          enabled_variants: [Number(variantId)],
        },
        // user-requested: one clean white page. The order summary at the top takes background_color (left out,
        // it came up black from the store's own setting, with dark text lost on it), so it's set white here,
        // text dark, and the button, links and checks in the brand red.
        checkout_options: {
          embed: false, media: false, logo: true, desc: true, discount: false,
          background_color: '#ffffff',
          headings_color: '#111114',
          primary_text_color: '#30313d',
          secondary_text_color: '#6a7383',
          borders_color: '#e3e8ee',
          links_color: '#ff3355',
          checkbox_color: '#ff3355',
          active_state_color: '#ff3355',
          button_color: '#ff3355',
          button_text_color: '#ffffff',
        },
        // filled in ahead; custom comes back in the webhook's meta.custom_data
        checkout_data: {
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.country ? { billing_address: { country: opts.country } } : {}),
          custom: { uid, item: itemId },
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: store } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  };
  const resp = await fetch(`${API}/checkouts`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });
  const data: any = await resp.json().catch(() => ({}));
  const url = data?.data?.attributes?.url;
  if (!resp.ok || !url) {
    console.error('ls_checkout_failed', resp.status, JSON.stringify(data?.errors || data));
    throw new Error(data?.errors?.[0]?.detail || 'Could not start checkout. Please try again.');
  }
  return url;
};
