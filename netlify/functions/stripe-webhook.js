/**
 * Netlify Function — POST /.netlify/functions/stripe-webhook
 *
 * Stripe calls this after a successful checkout. We use it to mark every
 * purchased item as `available: false` in `content/products/<id>.json`,
 * which hides it from the live site after Netlify rebuilds.
 *
 * Required env vars (set in Netlify → Site config → Environment variables):
 *   STRIPE_SECRET_KEY        — Stripe API key
 *   STRIPE_WEBHOOK_SECRET    — webhook signing secret (whsec_…)
 *   GITHUB_TOKEN             — fine-grained PAT with Contents: Read+Write on the repo
 *   GITHUB_REPO              — "owner/repo", e.g. "yourname/aureate-crystals"
 *   GITHUB_BRANCH            — branch to commit to (e.g. "master")
 *
 * Webhook setup (Stripe Dashboard → Developers → Webhooks):
 *   Endpoint URL: https://<your-site>.netlify.app/.netlify/functions/stripe-webhook
 *   Events to send: checkout.session.completed
 *   Copy the signing secret into STRIPE_WEBHOOK_SECRET.
 */

const Stripe = require('stripe');

const REPO   = process.env.GITHUB_REPO;
const TOKEN  = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || 'master';

async function gh(method, urlPath, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aureate-crystals-webhook',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    const e = new Error(`GitHub ${method} ${urlPath} → ${res.status}: ${err}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/**
 * Mark a product (or one of its variants) unavailable in content/products.
 * Retries on 409/422 (concurrent edits) up to 3 times.
 */
async function markUnavailable(productId, variantName) {
  const filePath = `content/products/${productId}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let file;
    try {
      file = await gh('GET', `contents/${filePath}?ref=${BRANCH}`);
    } catch (e) {
      if (e.status === 404) {
        console.warn(`[webhook] product file missing: ${filePath} — skipping`);
        return;
      }
      throw e;
    }

    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));

    if (variantName) {
      const v = (json.variants || []).find(v => v.name === variantName);
      if (!v) {
        console.warn(`[webhook] variant "${variantName}" not found on ${productId} — skipping`);
        return;
      }
      if (v.available === false) return; // already marked
      v.available = false;
    } else {
      if (json.available === false) return; // already marked
      json.available = false;
    }

    try {
      await gh('PUT', `contents/${filePath}`, {
        branch: BRANCH,
        message: `Mark ${productId}${variantName ? ` (${variantName})` : ''} sold via Stripe`,
        content: Buffer.from(JSON.stringify(json, null, 2) + '\n').toString('base64'),
        sha: file.sha,
      });
      return;
    } catch (e) {
      // 409 = sha conflict, 422 = stale. Re-fetch and retry.
      if (e.status === 409 || e.status === 422) continue;
      throw e;
    }
  }
  throw new Error(`[webhook] gave up marking ${productId} after retries`);
}

function decodeCart(metadata) {
  if (!metadata) return [];
  if (metadata.cart) {
    try { return JSON.parse(metadata.cart); } catch { return []; }
  }
  // Chunked fallback (set by create-checkout.js for huge carts)
  const n = Number(metadata.cart_chunks);
  if (n > 0) {
    let joined = '';
    for (let i = 0; i < n; i++) joined += metadata['cart_' + i] || '';
    try { return JSON.parse(joined); } catch { return []; }
  }
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const whSecret  = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !whSecret || !REPO || !TOKEN) {
    console.error('[webhook] missing required env vars');
    return { statusCode: 500, body: 'Webhook misconfigured' };
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });

  // Stripe needs the raw body for signature verification.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'],
      whSecret
    );
  } catch (e) {
    console.error('[webhook] signature verification failed:', e.message);
    return { statusCode: 400, body: `Bad signature: ${e.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;
  const cart = decodeCart(session.metadata);
  if (!cart.length) {
    console.warn('[webhook] no cart manifest on session', session.id);
    return { statusCode: 200, body: 'no manifest' };
  }

  // Process sequentially — keeps git history readable and avoids hammering
  // the GitHub API. A handful of items per checkout is normal.
  for (const item of cart) {
    try {
      await markUnavailable(String(item.id), item.v || '');
    } catch (e) {
      console.error('[webhook] failed to mark item', item, e.message);
      // Return 500 so Stripe retries. Idempotent — already-marked items skip.
      return { statusCode: 500, body: e.message };
    }
  }

  return { statusCode: 200, body: 'ok' };
};
