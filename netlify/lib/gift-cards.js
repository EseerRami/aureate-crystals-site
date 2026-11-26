const { createHash, randomBytes } = require('node:crypto');

class GiftError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function checkoutContext(request, requestedMode) {
  const origin = new URL(request.url).origin;
  const preview = process.env.CONTEXT === 'deploy-preview' || /^deploy-preview-\d+--/.test(new URL(origin).hostname);
  const mode = preview || requestedMode === 'test' ? 'test' : 'live';
  return { origin, mode, key: mode === 'test' ? process.env.STRIPE_TEST_KEY : process.env.STRIPE_SECRET_KEY };
}

function cardStore(mode) {
  const { getStore } = require('@netlify/blobs');
  return getStore({ name: 'gift-cards-' + mode, consistency: 'strong' });
}

function amountInCents(value) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) throw new GiftError('Enter a USD amount with up to two decimal places.');
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1000) throw new GiftError('The minimum gift card amount is $10.');
  return cents;
}

const hash = value => createHash('sha256').update(value).digest('hex');
function keyFor(code) {
  const compact = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^AC[0-9A-F]{24}$/.test(compact)) throw new GiftError('Check the gift card code and try again.');
  return hash(compact);
}

async function purchase(store, stripe, context, body) {
  const cents = amountInCents(body.amount);
  const email = String(body.email || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GiftError('Enter an email address for your receipt.');
  const code = 'AC-' + randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-');
  const key = keyFor(code);
  const page = context.origin + '/gift-cards/' + (context.mode === 'test' ? '?mode=test' : '');
  const name = 'Aureate Crystals digital gift card';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], customer_email: email,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents,
      product_data: { name, description: 'Redeem at Aureate Crystals with code ' + code } } }],
    payment_intent_data: { receipt_email: email, description: name + ' · Redeem with ' + code },
    metadata: { gift_purchase: key },
    success_url: page + '#' + code, cancel_url: page
  });
  const saved = await store.setJSON(key, { purchase: session.id, spent: 0, hold: null }, { onlyIfNew: true });
  if (!saved.modified) throw new Error('Could not register gift card purchase');
  return { url: session.url };
}

function completedDebit(session, key, amount) {
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) throw new GiftError('Your previous order is processing. Please try again shortly.', 409);
  if (session.metadata?.gift_debit !== key || session.total_details?.amount_discount !== amount) throw new Error('Gift debit mismatch');
  return amount;
}

async function settleOrder(store, session) {
  const key = session.metadata.gift_debit;
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await store.getWithMetadata(key, { type: 'json' });
    if (!record) throw new Error('Gift card record is missing');
    const card = record.data;
    if (card.hold?.sessionId !== session.id) return;
    const spent = card.spent + completedDebit(session, key, card.hold.amount);
    const result = await store.setJSON(key, { ...card, spent, hold: null }, { onlyIfMatch: record.etag });
    if (result.modified) return;
  }
  throw new Error('Gift card settlement is busy');
}

// One conditional write per balance change. An open Checkout Session reserves its
// amount. Stripe is authoritative about when the reservation settles or expires.
async function inspect(store, stripe, key, fingerprint) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await store.getWithMetadata(key, { type: 'json' });
    if (!record) throw new GiftError('Check the gift card code and try again.', 404);
    const card = record.data;
    const purchase = await stripe.checkout.sessions.retrieve(card.purchase, { expand: ['payment_intent.latest_charge'] });
    if (purchase.metadata?.gift_purchase !== key || purchase.currency !== 'usd' || purchase.payment_status !== 'paid') {
      throw new GiftError('This card is not active. It becomes available after payment.', 409);
    }
    const charge = purchase.payment_intent?.latest_charge;
    if (!charge || charge.disputed) throw new GiftError('This gift card is unavailable. Contact Aureate Crystals for help.', 409);
    const balance = Math.max(0, purchase.amount_total - charge.amount_refunded - card.spent);
    if (!card.hold) return { record, balance, reserved: 0 };
    const { sessionId, amount, cart } = card.hold;
    let order = await stripe.checkout.sessions.retrieve(sessionId);
    if (order.status === 'open' && fingerprint && (cart !== fingerprint || amount > balance)) {
      try { order = await stripe.checkout.sessions.expire(sessionId); }
      catch (error) {
        order = await stripe.checkout.sessions.retrieve(sessionId);
        if (order.status === 'open') throw error;
      }
    }
    if (order.status === 'open') return { record, balance, reserved: amount, url: order.url };
    let spent = card.spent;
    if (order.status === 'complete') {
      spent += completedDebit(order, key, amount);
    } else if (order.status !== 'expired') throw new Error('Unknown checkout state');
    await store.setJSON(key, { ...card, spent, hold: null }, { onlyIfMatch: record.etag });
  }
  throw new GiftError('Your gift card is being updated. Please try again.', 409);
}

async function redeem(store, stripe, code, params) {
  const key = keyFor(code);
  const fingerprint = hash(JSON.stringify([params.line_items, params.success_url]));
  const { balance, record, url } = await inspect(store, stripe, key, fingerprint);
  if (url) return { url };
  const total = params.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0);
  let amount = Math.min(total, balance);
  // When a split payment is needed, leave at least Stripe's 50-cent USD minimum
  // to charge. Any additional cents stay on the gift card for the next order.
  if (amount < total) amount = Math.min(amount, total - 50);
  if (amount <= 0) throw new GiftError(balance ? 'This order is below the minimum for a split payment.' : 'This gift card has no balance left.');
  const expires = Math.floor(Date.now() / 1000) + 32 * 60;
  const coupon = await stripe.coupons.create({ name: 'Aureate Crystals gift card', duration: 'once',
    currency: 'usd', amount_off: amount, max_redemptions: 1, redeem_by: expires + 60 });
  const session = await stripe.checkout.sessions.create({ ...params, payment_method_types: ['card'],
    expires_at: expires, discounts: [{ coupon: coupon.id }], metadata: { ...params.metadata, gift_debit: key } });
  const saved = await store.setJSON(key, { ...record.data, hold: { sessionId: session.id, amount, cart: fingerprint } }, { onlyIfMatch: record.etag });
  if (!saved.modified) {
    await stripe.checkout.sessions.expire(session.id);
    throw new GiftError('Another checkout just updated this card. Please try again.', 409);
  }
  return { url: session.url };
}

module.exports = { GiftError, checkoutContext, cardStore, amountInCents, keyFor, purchase, inspect, redeem, settleOrder };
