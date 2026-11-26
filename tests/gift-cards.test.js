const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amountInCents, keyFor, purchase, inspect, redeem, settleOrder } = require('../netlify/lib/gift-cards');

function fixture() {
  const records = new Map();
  const sessions = new Map();
  const coupons = new Map();
  const store = {
    async getWithMetadata(key) { return structuredClone(records.get(key) || null); },
    async setJSON(key, data, { onlyIfMatch, onlyIfNew }) {
      const prev = records.get(key);
      if (onlyIfNew ? !!prev : prev?.etag !== onlyIfMatch) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(Number(prev?.etag || 0) + 1) });
      return { modified: true };
    }
  };
  const stripe = {
    coupons: { async create(c) { const id = 'coupon_' + coupons.size; coupons.set(id, c); return { id }; } },
    checkout: { sessions: {
      async create(p) {
        const id = 'cs_test_' + sessions.size;
        const value = p.line_items.reduce((n, i) => n + i.quantity * i.price_data.unit_amount, 0);
        const discount = p.discounts ? coupons.get(p.discounts[0].coupon).amount_off : 0;
        const session = { ...p, id, url: 'https://checkout.stripe.com/' + id, status: 'open', currency: 'usd',
          payment_status: 'unpaid', amount_total: value - discount, total_details: { amount_discount: discount } };
        sessions.set(id, session);
        return session;
      },
      async retrieve(id) { return structuredClone(sessions.get(id)); },
      async expire(id) { const s = sessions.get(id); if (s.status !== 'open') throw Error(); s.status = 'expired'; return s; }
    } }
  };
  async function buy(amount, paid = true) {
    await purchase(store, stripe, { origin: 'https://example.com', mode: 'test' }, { amount, email: 'test@example.com' });
    const session = [...sessions.values()].at(-1);
    if (paid) {
      session.status = 'complete'; session.payment_status = 'paid';
      session.payment_intent = { latest_charge: { amount_refunded: 0, disputed: false } };
    }
    return session.success_url.split('#')[1];
  }
  const order = (price, code) => redeem(store, stripe, code, { line_items: [{ quantity: 1, price_data: { unit_amount: price } }], success_url: 'https://example.com', metadata: {} });
  const get = code => inspect(store, stripe, keyFor(code));
  const finish = url => {
    const s = sessions.get(url.split('/').pop());
    s.status = 'complete'; s.payment_status = s.amount_total ? 'paid' : 'no_payment_required';
    return s;
  };
  return { buy, order, get, finish, sessions, store, stripe };
}

test('custom USD amounts preserve cents and require a $10 minimum', () => {
  for (const [v,n] of [['10',1000],['10.01',1001],['123.45',12345]]) assert.equal(amountInCents(v),n);
  for (const v of ['9.99','-10','10.0001','1e3','',null]) assert.throws(() => amountInCents(v));
});

test('unpaid, unknown, disputed and refunded purchases cannot fund a new order', async () => {
  const f = fixture();
  const unpaid = await f.buy('10', false);
  await assert.rejects(f.order(5000,unpaid));
  await assert.rejects(f.order(5000,'AC-1111-1111-1111-1111-1111-1111'));
  const paid = await f.buy('20.55');
  const charge = [...f.sessions.values()].at(-1).payment_intent.latest_charge;
  charge.amount_refunded = 555;
  assert.equal((await f.get(paid)).balance,1500);
  charge.disputed = true;
  await assert.rejects(f.order(5000,paid));
});

test('a paid card covers an order, retains its balance, then splits another tender', async () => {
  const f = fixture(), code = await f.buy('500'), key = keyFor(code);
  const first = await f.order(43300,code);
  assert.equal((await f.order(43300,code)).url,first.url);
  assert.equal((await f.get(code)).reserved,43300);
  const complete = f.finish(first.url);
  assert.equal(complete.amount_total,0);
  await Promise.all([settleOrder(f.store,complete), f.get(code)]);
  await settleOrder(f.store,complete);
  assert.equal((await f.get(code)).balance,6700);
  const second = f.finish((await f.order(43300,code)).url);
  assert.equal(second.amount_total,36600);
  assert.equal(second.metadata.gift_debit,key);
  assert.equal((await f.get(code)).balance,0);
  await assert.rejects(f.order(43300,code));
});

test('concurrent carts cannot spend twice and expiry releases credit', async () => {
  const f = fixture(), code = await f.buy('50');
  const requests = await Promise.allSettled([f.order(3000,code),f.order(3000,code)]);
  assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);
  const session = [...f.sessions.values()].find(s=>s.metadata.gift_debit && s.status==='open');
  await f.stripe.checkout.sessions.expire(session.id);
  assert.equal((await f.get(code)).balance,5000);
  assert.equal((await f.get(code)).reserved,0);
  const old = await f.order(3000,code);
  await f.order(4000,code);
  assert.equal(f.sessions.get(old.url.split('/').pop()).status,'expired');
});

test('sub-minimum split tender retains the extra cents as gift credit', async () => {
  const f = fixture(), code = await f.buy('10');
  const checkout = f.finish((await f.order(1001,code)).url);
  assert.equal(checkout.amount_total,50);
  assert.equal((await f.get(code)).balance,49);
});
