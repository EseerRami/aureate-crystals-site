import Stripe from 'stripe';
import giftCards from '../lib/gift-cards.js';
const { GiftError, checkoutContext, cardStore, keyFor, purchase, inspect } = giftCards;
const reply = (statusCode, data) => Response.json(data, { status: statusCode, headers: { 'Cache-Control': 'no-store' } });

export default async function handler(request) {
  if (request.method !== 'POST') return reply(405, { error: 'Use POST for gift cards.' });
  let body;
  try { body = await request.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
  if (!['buy', 'balance'].includes(body?.action)) return reply(400, { error: 'Select a gift card action.' });
  try {
    const context = checkoutContext(request, body.mode);
    if (!context.key) throw new GiftError('Gift card payments are unavailable in this environment.', 503);
    const stripe = new Stripe(context.key, { apiVersion: '2024-11-20.acacia' });
    const store = cardStore(context.mode);
    if (body.action === 'buy') return reply(200, await purchase(store, stripe, context, body));
    const { balance, reserved } = await inspect(store, stripe, keyFor(body.code));
    return reply(200, { balance, reserved });
  } catch (err) {
    if (err instanceof GiftError) return reply(err.status, { error: err.message });
    console.error('Gift card request failed', err.name, err.code || err.statusCode || '', err.code === 'MODULE_NOT_FOUND' ? err.message.split('\n')[0] : '');
    return reply(503, { error: 'Gift cards are temporarily unavailable. Please try again.' });
  }
}
