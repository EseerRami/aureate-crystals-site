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

const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const PRODUCTS_FILE = path.join(__dirname, '..', '..', 'data', 'products.json');
const VARIANTS_FILE = path.join(__dirname, '..', '..', 'data', 'variant-prices.clean.json');

let PRODUCTS, VARIANTS;
function loadCatalog() {
  if (!PRODUCTS) PRODUCTS = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  if (!VARIANTS) VARIANTS = JSON.parse(fs.readFileSync(VARIANTS_FILE, 'utf-8'));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Test vs live mode is decided by the client (which page sent the request).
  // /testing/ sends mode='test' → uses STRIPE_TEST_KEY; otherwise live.
  const mode = body.mode === 'test' ? 'test' : 'live';
  const stripeKey = mode === 'test' ? process.env.STRIPE_TEST_KEY : process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Stripe ${mode} mode is not configured on the server.` }),
    };
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  try {
    loadCatalog();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Catalog data missing on server' }) };
  }

  // Validate + build line_items from server-side catalog.
  // We also collect a compact cart manifest to attach to the Stripe session
  // metadata — the post-purchase webhook reads it back to mark items sold.
  const line_items = [];
  const cartManifest = [];
  for (const item of items) {
    const productId = String(item.id);
    const variantName = (item.variantName || '').toString();
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));

    const product = PRODUCTS.find(p => String(p.id) === productId);
    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown product id ${productId}` }) };
    }

    let unitAmount;           // cents
    let displayName = product.name;

    cartManifest.push({ id: productId, v: variantName, q: qty });

    if (variantName) {
      const variants = VARIANTS[productId] || [];
      const variant = variants.find(v => v.n === variantName);
      if (!variant) {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown variant "${variantName}" for product ${productId}` }) };
      }
      if (!variant.a) {
        return { statusCode: 400, body: JSON.stringify({ error: `Variant "${variantName}" is sold out` }) };
      }
      if (typeof variant.p !== 'number' || variant.p <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: `No price available for variant "${variantName}"` }) };
      }
      unitAmount = Math.round(variant.p * 100);
      displayName += ` — Style ${variantName}`;
    } else {
      if (typeof product.price !== 'number' || product.price <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: `Invalid price for product ${productId}` }) };
      }
      unitAmount = Math.round(product.price * 100);
    }

    line_items.push({
      quantity: qty,
      price_data: {
        currency: 'usd',
        product_data: {
          name: displayName,
          images: product.image ? [product.image] : [],
        },
        unit_amount: unitAmount,
      },
    });
  }

  // Origin URL for success/cancel redirects
  const origin = event.headers.origin || `https://${event.headers.host || 'localhost'}`;

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
  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
