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
 * Required env var: STRIPE_SECRET_KEY  (set in Netlify dashboard)
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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe is not configured (STRIPE_SECRET_KEY missing).' }) };
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  try {
    loadCatalog();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Catalog data missing on server' }) };
  }

  // Validate + build line_items from server-side catalog
  const line_items = [];
  for (const item of items) {
    const productId = Number(item.id);
    const variantName = (item.variantName || '').toString();
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));

    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown product id ${productId}` }) };
    }

    let unitAmount;           // cents
    let displayName = product.name;

    if (variantName) {
      const variants = VARIANTS[String(productId)] || [];
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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`,
    // Enable taxes + shipping when you're ready — for now, simplest flow.
    shipping_address_collection: { allowed_countries: ['US', 'CA'] },
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
