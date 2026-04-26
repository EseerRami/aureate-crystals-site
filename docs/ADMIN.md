# Admin / CMS Setup

Your wife edits products at **`yoursite.com/admin/`** through Decap CMS. Saving in the admin commits JSON to the GitHub repo, Netlify rebuilds automatically, and the live site updates within ~60 seconds.

This doc covers the **one-time setup**. After it's done, day-to-day editing is just "go to /admin/, fill out the form, hit Save."

---

## One-time setup (you, ~10 min)

### 1. Push the site to GitHub

If you haven't already:

```bash
cd aureate-crystals-site
git init
git add .
git commit -m "Initial commit"
gh repo create aureate-crystals --private --source=. --push
```

(Or create the repo on github.com manually and push.)

### 2. Connect to Netlify

- netlify.com → **Add new site → Import from Git** → pick the `aureate-crystals` repo
- Build settings should auto-detect from `netlify.toml` (build command `node scripts/build-catalog.js`, publish directory `.`)
- Click **Deploy**

### 3. Enable Netlify Identity (the auth layer)

In your Netlify site dashboard:

1. Go to **Site configuration → Identity** → click **Enable Identity**
2. Under **Registration preferences**, choose **Invite only** (so randos can't sign up)
3. Under **Git Gateway** (same Identity panel, scroll down), click **Enable Git Gateway**
   - This lets the CMS commit to your repo without each editor having a GitHub account.

### 4. Set the Stripe key

- Site configuration → **Environment variables** → Add
- Key: `STRIPE_SECRET_KEY`, Value: your `sk_test_…` (or `sk_live_…` for production)
- Trigger a redeploy (Deploys → Trigger deploy)

### 5. Invite your wife

- Identity tab → **Invite users** → enter her email → Send
- She gets an email, clicks the link, sets a password, and lands on `yoursite.com/admin/`
- That's it — she's in.

---

## Day-to-day: how she adds a product

1. Go to **`yoursite.com/admin/`** (bookmark this), log in
2. Click **Crystals → New Crystal**
3. Fill in:
   - **ID** — next unused number (the form shows existing ones; e.g. if last was 90, type 91)
   - **Name** — e.g. "Rose Quartz Heart Carving"
   - **Price** — in dollars, e.g. `24.50`
   - **Main image** — drag-drop a square photo
   - **Description** — optional
   - **Rating / Sold count** — leave defaults (5 stars, 0 sold) for new items
   - **Chakras** — pick one or more from the dropdown
   - **Properties** — type tags like `love, healing, harmony` (comma-separated)
   - **Variants** — only if the crystal has size/color options. Click "Add variant", fill name + price + image, repeat.
4. Click **Save**
5. Wait ~60 seconds — refresh the live site, the new product appears.

### Editing an existing product

1. Crystals list → click the one she wants → make changes → Save
2. Same ~60 second propagation

### Marking something sold out

Two ways:
- **Whole product sold out** — delete it (trash icon), or just leave it up but bump price irrelevantly
- **A specific variant sold out** — open the product, find the variant, uncheck **Available**, Save. The site will keep showing it but with a strikethrough.

### Deleting a product

Open the product → trash icon → confirm. It commits a deletion to the repo and the product disappears from the live site after rebuild.

---

## How it works under the hood

- Each product = one JSON file in `content/products/{id}.json`
- Wife's image uploads land in `assets/products/`
- Netlify build runs `node scripts/build-catalog.js` which:
  1. Reads all `content/products/*.json`
  2. Inlines them into `index.html` (the `const PRODUCTS` and `const VARIANTS` blocks)
  3. Regenerates `data/products.json` and `data/variant-prices.clean.json` (used by the Stripe Checkout function as the server-side authoritative price source)
- The Stripe function rejects any cart that doesn't match those server files, so prices can never be tampered with from the browser.

---

## Local development

To preview catalog changes locally:

```bash
node scripts/build-catalog.js   # regenerates index.html + data files
serve.bat                       # opens localhost:8000
```

To re-seed `content/products/` from the current `index.html` (one-time, or after manual index.html edits):

```bash
node scripts/migrate-to-cms.js
```

---

## Troubleshooting

**"Login fails / nothing happens at /admin/"**
- Check Identity is enabled on the Netlify site
- Check Git Gateway is enabled (same Identity panel)
- Try a hard refresh (Ctrl-Shift-R)

**"I saved a product but the site doesn't show it"**
- Wait 60-90 seconds for Netlify to rebuild — check Deploys tab
- If the deploy failed, click into it and read the log; usually a malformed JSON file in `content/products/` (the CMS rarely produces these but a manual edit can)

**"Image won't upload"**
- Decap requires Git LFS off and small files. Aim for images < 1 MB. If you need bigger, compress first (e.g. squoosh.app).

**"I want to undo something"**
- Every save is a git commit. `git log content/products/` shows history; revert via `git revert <sha>` and push. Or use the Netlify dashboard → Deploys → "Publish deploy" on an older deploy to instantly roll back the live site.
