/**
 * Netlify Function — POST /.netlify/functions/create-checkout
 *
 * Receives a cart from the client, validates every line item against
 * server-side authoritative data (data/products.json and
 * data/variant-prices.clean.json), creates a Stripe Checkout Session,
 * and returns { url } which the client redirects to.
 *
 * Why server-authoritative pricing? A malicious client can edit the JS
 * and send a crystal at $0.01. We never trust client-sent prices —
 * only (productId, variantName, qty) — and look up the real price.
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY   — live mode key (sk_live_…)
 *   STRIPE_TEST_KEY     — test mode key (sk_test_…); used when client posts mode='test'
 */

import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import giftCards from '../lib/gift-cards.js';
const { GiftError, checkoutContext, cardStore, redeem } = giftCards;

const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const VARIANTS_FILE = path.join(process.cwd(), 'data', 'variant-prices.clean.json');

let PRODUCTS, VARIANTS;
function loadCatalog() {
  if (!PRODUCTS) PRODUCTS = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  if (!VARIANTS) VARIANTS = JSON.parse(fs.readFileSync(VARIANTS_FILE, 'utf-8'));
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Test vs live mode is decided by the client (which page sent the request).
  // /testing/ sends mode='test' → uses STRIPE_TEST_KEY; otherwise live.
  const { mode, key: stripeKey, origin } = checkoutContext(request, body.mode);
  if (!stripeKey) {
    return Response.json({ error: `Stripe ${mode} mode is not configured on the server.` }, { status: 500 });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return Response.json({ error: 'Cart is empty' }, { status: 400 });
  }

  try {
    loadCatalog();
  } catch (e) {
    return Response.json({ error: 'Catalog data missing on server' }, { status: 500 });
  }

  // Validate + build line_items from server-side catalog.
  // We also collect a compact cart manifest to attach to the Stripe session
  // metadata — the post-purchase webhook reads it back to mark items sold.
  const line_items = [];
  const cartManifest = [];
  for (const item of items) {
    const productId = String(item.id);
    const variantName = (item.variantName || '').toString();
    const qty = Number(item.qty ?? 1);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
      return Response.json({ error: 'Invalid item quantity.' }, { status: 400 });
    }

    const product = PRODUCTS.find(p => String(p.id) === productId);
    if (!product) {
      return Response.json({ error: `Unknown product id ${productId}` }, { status: 400 });
    }

    let unitAmount;           // cents
    let displayName = product.name;

    cartManifest.push({ id: productId, v: variantName, q: qty });

    if (variantName) {
      const variants = VARIANTS[productId] || [];
      const variant = variants.find(v => v.n === variantName);
      if (!variant) {
        return Response.json({ error: `Unknown variant "${variantName}" for product ${productId}` }, { status: 400 });
      }
      if (!variant.a) {
        return Response.json({ error: `Variant "${variantName}" is sold out` }, { status: 400 });
      }
      if (typeof variant.p !== 'number' || variant.p <= 0) {
        return Response.json({ error: `No price available for variant "${variantName}"` }, { status: 400 });
      }
      unitAmount = Math.round(variant.p * 100);
      displayName += ` — Style ${variantName}`;
    } else {
      if (typeof product.price !== 'number' || product.price <= 0) {
        return Response.json({ error: `Invalid price for product ${productId}` }, { status: 400 });
      }
      unitAmount = Math.round(product.price * 100);
    }

    line_items.push({
      quantity: qty,
      price_data: {
        currency: 'usd',
        product_data: {
          name: displayName,
          images: product.image ? [new URL(product.image, origin).href] : [],
        },
        unit_amount: unitAmount,
      },
    });
  }

  // Stripe metadata caps each value at 500 chars. Compact manifest fits
  // ~20 line items in 500B; chunk if your catalog ever exceeds that.
  const cartJson = JSON.stringify(cartManifest);
  // Return to wherever the buyer came from — keep test mode buyers on /testing/.
  const returnPath = mode === 'test' ? '/testing/' : '/';

  const sessionParams = {
    mode: 'payment',
    line_items,
    success_url: `${origin}${returnPath}?checkout=success`,
    cancel_url: `${origin}${returnPath}?checkout=cancel`,
    shipping_address_collection: { allowed_countries: ['US', 'CA'] },
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
  };
  if (cartJson.length <= 500) {
    sessionParams.metadata = { cart: cartJson };
  } else {
    // Fallback for huge carts — split into 1..N chunks (cart_0, cart_1, ...).
    const chunks = cartJson.match(/.{1,490}/g) || [];
    sessionParams.metadata = Object.fromEntries(
      chunks.map((c, i) => ['cart_' + i, c]).concat([['cart_chunks', String(chunks.length)]])
    );
  }
  let session;
  try {
    session = body.giftCode
      ? await redeem(cardStore(mode), stripe, body.giftCode, sessionParams)
      : await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    if (!(err instanceof GiftError)) console.error('Checkout unavailable', err.name, err.code || '');
    return Response.json({ error: err instanceof GiftError ? err.message : 'Checkout is temporarily unavailable. Please try again.' },
      { status: err instanceof GiftError ? err.status : 503 });
  }

  return Response.json({ url: session.url });
}
