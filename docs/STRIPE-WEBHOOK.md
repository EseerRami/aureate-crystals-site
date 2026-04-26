# Stripe Webhook — Auto-Mark-Sold

When a Stripe checkout completes, this site fires a webhook that marks every purchased item as `available: false` in `content/products/<id>.json`. Netlify auto-rebuilds and the items disappear from the live site within ~60 seconds.

This is one-time setup. After it's done, sales auto-update inventory with no manual steps.

---

## 1. Create a GitHub Personal Access Token (PAT)

The webhook needs to commit changes to your repo.

1. github.com → Settings (top right avatar) → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Name: `aureate-crystals-webhook`
3. Expiration: 1 year (re-rotate annually)
4. **Repository access**: "Only select repositories" → pick `aureate-crystals`
5. **Permissions** (Repository permissions section):
   - **Contents**: Read and write
   - (Leave everything else as "No access")
6. Generate → copy the `github_pat_...` token immediately (you won't see it again)

## 2. Add env vars to Netlify

Site dashboard → **Site configuration → Environment variables → Add a variable**. Add all four:

| Key | Value |
|---|---|
| `GITHUB_TOKEN` | the `github_pat_...` from step 1 |
| `GITHUB_REPO` | `<your-username>/aureate-crystals` |
| `GITHUB_BRANCH` | `master` (or `main` if you switched) |
| `STRIPE_WEBHOOK_SECRET` | filled in step 4 below |

`STRIPE_SECRET_KEY` should already be set from earlier checkout setup.

## 3. Deploy the webhook function

Just push to GitHub. Netlify picks up `netlify/functions/stripe-webhook.js` automatically and exposes it at:

```
https://<your-site>.netlify.app/.netlify/functions/stripe-webhook
```

Confirm it deployed: **Functions** tab in Netlify → you should see `stripe-webhook` listed.

## 4. Register the webhook with Stripe

1. Stripe Dashboard → **Developers → Webhooks** → **Add endpoint**
2. Endpoint URL: `https://<your-site>.netlify.app/.netlify/functions/stripe-webhook`
3. **Events to send**: search for and select **`checkout.session.completed`** (just that one)
4. Click **Add endpoint**
5. On the webhook detail page, click **Reveal signing secret** → copy the `whsec_...` value
6. Paste it into Netlify as the `STRIPE_WEBHOOK_SECRET` env var (step 2 above)
7. Trigger a redeploy in Netlify so the function picks up the new env vars

## 5. Test it

In Stripe Dashboard → Webhooks → your endpoint → **Send test webhook** → pick `checkout.session.completed` → Send.

The function will run but find no cart manifest in the test event and will return 200 with body `no manifest`. That confirms signature verification works. The real test is making an actual test-mode purchase (`4242 4242 4242 4242`):

1. Go to your live site
2. Add a crystal (preferably a cheap one or a test product) to the cart
3. Go through Stripe Checkout with the test card
4. Within ~60 seconds, the product should disappear from the public site
5. Check GitHub commit history — there'll be a new commit like `Mark 050 sold via Stripe`

---

## How to "un-sell" a product

A sale was a mistake (refund, customer changed mind, you found a duplicate stone)? Just go to `/admin/`, open the product, toggle **Available for purchase** back on, hit Save. It re-appears on the site after the next deploy.

## Troubleshooting

**"Webhook endpoint returned 500"** in Stripe dashboard
- Open Netlify → Functions → `stripe-webhook` → Logs
- Most common: missing env var, expired GITHUB_TOKEN, or wrong GITHUB_REPO format (must be `owner/repo`)

**Webhook fires but product doesn't update**
- Check Netlify deploys — did a new build trigger after the commit?
- Check GitHub commit history — did the webhook actually commit?
- Check the product file content — is `available: false` set?

**"Bad signature" errors**
- `STRIPE_WEBHOOK_SECRET` is wrong. Recopy from Stripe Dashboard → Webhooks → your endpoint → Signing secret.

**Race condition: two simultaneous sales of the same item**
- Both checkouts succeed at Stripe, both buyers pay. Only one piece exists.
- Resolution: refund one buyer in Stripe Dashboard. The webhook ran for both but only took effect once (idempotent).
- Mitigation if this becomes a real problem: switch to Stripe Inventory or a real database. For one-of-a-kind crystals at this scale, refunds are rare enough that it's not worth the complexity.

## What if I want to disable auto-mark-sold?

Just remove the webhook endpoint in Stripe Dashboard. The function stays deployed but never fires. You can also delete `netlify/functions/stripe-webhook.js` if you want to remove it permanently.
