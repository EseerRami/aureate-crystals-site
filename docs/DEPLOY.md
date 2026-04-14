# Deploying to Netlify + Stripe

This site is a static `index.html` plus one Netlify Function for Stripe
Checkout. Total deploy time: ~10 minutes.

## One-time setup

### 1. Stripe account
1. Create an account at [stripe.com](https://stripe.com) if you haven't already.
2. In the Stripe Dashboard: **Developers → API keys → Secret key** → copy it.
   - Start in **Test mode** (toggle top-right) while you're verifying — use
     the test secret key (`sk_test_...`). Switch to live keys only once
     you've done a real test purchase.

### 2. Push the site to GitHub (or GitLab/Bitbucket)
Netlify deploys from a Git repo. From the project root:
```bash
git init
git add .
git commit -m "Initial storefront"
# Create a new empty repo on GitHub, then:
git remote add origin https://github.com/<you>/aureate-crystals.git
git push -u origin main
```

### 3. Netlify site
1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
2. Choose your Git provider, pick the repo.
3. Build settings — Netlify auto-detects from `netlify.toml`:
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
   - Build command: *(leave empty)*
4. Click **Deploy**.

### 4. Add the Stripe secret key
After the first deploy:
1. Netlify site dashboard → **Site configuration → Environment variables → Add a variable**.
2. Key: `STRIPE_SECRET_KEY`
3. Value: your Stripe secret key (start with `sk_test_...`)
4. Scope: **All scopes** (or at least Functions).
5. **Deploys → Trigger deploy → Deploy site** so the function picks up the new env var.

## Verifying

1. Open your `.netlify.app` URL.
2. Add a crystal to the cart, click **Checkout with Stripe ✦**.
3. You should be redirected to Stripe Checkout. Use test card
   `4242 4242 4242 4242` with any future expiry, any CVC, any ZIP.
4. After payment you're returned to `/?checkout=success` and the cart clears.

If the button gives an error toast, check Netlify → Functions → `create-checkout` logs.

## Going live

1. Switch the Stripe dashboard to **live mode**, copy the **live** secret key (`sk_live_...`).
2. In Netlify env vars, update `STRIPE_SECRET_KEY` to the live key.
3. Trigger a new deploy.
4. Do one real purchase of a cheap item to confirm end-to-end.

## Updating the catalog

When `index.html`'s `PRODUCTS` array changes, or after re-running the scraper:
```bash
cd scraper
node clean-and-inline.js      # regenerate variant-prices.clean.json
node inline-into-index.js     # push cleaned variants into index.html
node extract-products.js      # regenerate data/products.json (server-authoritative)
```
Then `git commit && git push` — Netlify auto-deploys.

**If you forget `extract-products.js`:** the client shows the new product but
checkout fails with "Unknown product id". Always re-extract after adding products.

## Security notes

- The function validates every cart item against `data/products.json` and
  `data/variant-prices.clean.json` server-side. A client can't send a
  $0.01 price — the function looks up the real price.
- Sold-out variants are rejected by the function with a clear error.
- `STRIPE_SECRET_KEY` lives only in Netlify env — never committed to git
  (see `.gitignore` which excludes `.env`).

## What's NOT wired yet

- **Email confirmations**: Stripe sends its own receipt by default. If you
  want a custom "order confirmation" email, add a Stripe webhook handler.
- **Inventory**: the site's sold-out flag is baked in at scrape time. When
  a variant sells via Stripe, the site doesn't know. Simplest approach:
  re-scrape periodically (or manually mark sold-out).
- **Tax**: `automatic_tax` is disabled. Enable it in
  `netlify/functions/create-checkout.js` once you've configured tax
  settings in the Stripe dashboard.
- **Shipping rates**: currently collects US/CA addresses but doesn't add
  shipping cost. Add `shipping_options` to the Stripe session if you
  need flat-rate or weight-based shipping.
