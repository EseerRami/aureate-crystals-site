const Stripe = require('stripe');
const { GiftError, checkoutContext, cardStore, keyFor, purchase, inspect } = require('../lib/gift-cards');
const reply = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Use POST for gift cards.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request.' }); }
  if (!['buy', 'balance'].includes(body?.action)) return reply(400, { error: 'Select a gift card action.' });
  try {
    const context = checkoutContext(event, body.mode);
    if (!context.key) throw new GiftError('Gift card payments are unavailable in this environment.', 503);
    const stripe = new Stripe(context.key, { apiVersion: '2024-11-20.acacia' });
    const store = cardStore(event, context.mode);
    if (body.action === 'buy') return reply(200, await purchase(store, stripe, context, body));
    const { balance, reserved } = await inspect(store, stripe, keyFor(body.code));
    return reply(200, { balance, reserved });
  } catch (err) {
    if (err instanceof GiftError) return reply(err.status, { error: err.message });
    console.error('Gift card request failed', err.name, err.code || err.statusCode || '');
    return reply(503, { error: 'Gift cards are temporarily unavailable. Please try again.' });
  }
};
