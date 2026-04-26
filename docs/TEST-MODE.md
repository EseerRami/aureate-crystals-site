# Test Mode + Maintenance

Two related operator features:

- **`/testing/`** — a parallel copy of the shop that uses Stripe test mode. Use this URL to do dry-run purchases without charging real cards or marking inventory sold. Bookmark it.
- **Maintenance mode** — an env-controlled overlay that takes the public shop offline so you can update inventory, do a photo refresh, etc. `/testing/` and `/admin/` keep working.

## Setup

### Test mode

1. **Stripe Dashboard** → top-right toggle to **Test mode** → Developers → API keys → copy the **Secret key** (starts with `sk_test_…`).
2. **Netlify** → Site config → Environment variables → Add:
   - Key: `STRIPE_TEST_KEY`
   - Value: the `sk_test_…` you just copied
3. Trigger a redeploy. Done — `/testing/` is now usable.

That's all. Live mode keeps using `STRIPE_SECRET_KEY` (your `sk_live_…`) unchanged.

### Maintenance mode

To take the public shop offline:

1. **Netlify** → Environment variables → Add:
   - Key: `MAINTENANCE_MODE`
   - Value: `true`
2. Trigger a redeploy
3. Public site at `/` shows a "Restocking" overlay. `/testing/` and `/admin/` still work normally.

To bring the shop back online:

1. Delete the `MAINTENANCE_MODE` env var (or set it to anything other than `true`)
2. Trigger a redeploy

## Daily use

### Doing a test purchase
1. Go to **`yoursite.com/testing/`**
2. Blue banner at the top confirms test mode
3. Add a crystal → checkout → Stripe Checkout opens with `[TEST MODE]` branding
4. Use card `4242 4242 4242 4242`, any future date, any CVC
5. After payment you land back on `/testing/?checkout=success` with the cart cleared
6. **The product is NOT marked sold** — test purchases skip the webhook, so test runs don't damage real inventory

### Doing a real purchase (you OR a customer)
- Just use the regular site at `/`
- Real cards required, real money charged, webhook fires, product marks sold

### Verifying webhook works without spending money
- The webhook only fires for **live** purchases by design
- To verify it works, do a real cheap purchase (e.g. set one product to $1 temporarily) on `/`
- Refund yourself in Stripe Dashboard afterward — the product stays marked sold but you can toggle it back on in `/admin/`

## Why two URLs instead of one toggle?

A query param like `?testmode=1` would be:
- guessable (random visitors could trigger it accidentally)
- forgotten on navigation (every link click would lose the mode)
- hard to bookmark cleanly

A separate `/testing/` path:
- has a real banner you can't miss
- preserves test mode across navigation
- is bookmark-friendly
- never leaks into search engines (we can add `noindex` later if needed)

## How it works under the hood

- `scripts/build-catalog.js` reads `MAINTENANCE_MODE` env var on every Netlify build
- It generates **two** copies of the site:
  - `index.html` — the public shop, with `window.AUREATE_MODE = "live"` and maintenance overlay potentially active
  - `testing/index.html` — same site but `window.AUREATE_MODE = "test"`, maintenance overlay always off
- The browser's `checkout()` function reads `window.AUREATE_MODE` and sends it to the Netlify function
- `netlify/functions/create-checkout.js` switches between `STRIPE_SECRET_KEY` and `STRIPE_TEST_KEY` based on that value
- Stripe webhook only fires for live purchases (you only register the live webhook in Stripe Dashboard)

No data is duplicated — both pages share the same `data/products.json` and `data/variant-prices.clean.json`.
