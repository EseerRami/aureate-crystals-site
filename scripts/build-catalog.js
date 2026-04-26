/**
 * Build step: reads content/products/*.json (the CMS-managed source of truth)
 * and regenerates everything else:
 *   - Inlines `const PRODUCTS = [...]` and `const VARIANTS = {...}` in index.html
 *   - Writes data/products.json (slim, server-authoritative for Stripe)
 *   - Writes data/variant-prices.clean.json (variant validation for Stripe)
 *
 * Runs on every Netlify deploy. Idempotent — running locally produces the same
 * output that Netlify would deploy.
 */

const fs = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const CONTENT   = path.join(ROOT, 'content', 'products');
const INDEX     = path.join(ROOT, 'index.html');
const OUT_PROD  = path.join(ROOT, 'data', 'products.json');
const OUT_VAR   = path.join(ROOT, 'data', 'variant-prices.clean.json');

// ───── Load all product JSON files, sort by id ─────
const files = fs.readdirSync(CONTENT).filter(f => f.endsWith('.json'));
const products = files
  .map(f => JSON.parse(fs.readFileSync(path.join(CONTENT, f), 'utf-8')))
  .sort((a, b) => (a.id || 0) - (b.id || 0));

if (!products.length) {
  console.error('❌ No products found in content/products/');
  process.exit(1);
}

// ───── Build inline PRODUCTS array ─────
// Field order matches the existing inline format for clean diffs.
function escapeJsString(s) {
  return JSON.stringify(s);
}

function arrLit(arr) {
  return '[' + arr.map(escapeJsString).join(',') + ']';
}

// Decap's tag-list widget stores values as a CSV string. Accept either form.
function toTagArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

const productLines = products.map(p => {
  const fields = [
    `id:${p.id}`,
    `name:${escapeJsString(p.name)}`,
    `price:${p.price}`,
    `rating:${typeof p.rating === 'number' ? p.rating : 5}`,
    `sold:${typeof p.sold === 'number' ? p.sold : 0}`,
    `image:${escapeJsString(p.image || '')}`,
    `chakra:${arrLit(p.chakra || [])}`,
    `properties:${arrLit(toTagArray(p.properties))}`,
  ];
  if (p.description) fields.push(`description:${escapeJsString(p.description)}`);
  return `  { ${fields.join(', ')} }`;
});

const productsBlock =
  'const PRODUCTS = [\n' +
  productLines.join(',\n') +
  '\n];';

// ───── Build inline VARIANTS object ─────
// Use compact JSON so the diff stays a single line (matches existing format).
const variantsObj = {};
for (const p of products) {
  if (Array.isArray(p.variants) && p.variants.length) {
    variantsObj[String(p.id)] = p.variants.map(v => ({
      n: v.name,
      p: typeof v.price === 'number' ? v.price : 0,
      a: !!v.available,
      // Store full URL (or path) directly in `i`. variantImgUrl in index.html
      // returns it as-is if it looks like a URL/path.
      i: v.image || '',
    }));
  }
}
const variantsBlock = 'const VARIANTS = ' + JSON.stringify(variantsObj) + ';';

// ───── Write index.html with both blocks replaced ─────
let html = fs.readFileSync(INDEX, 'utf-8');

// Replace PRODUCTS — non-greedy match from `const PRODUCTS = [` to first `];`
const productsRe = /const PRODUCTS\s*=\s*\[[\s\S]*?\n\];/;
if (!productsRe.test(html)) {
  console.error('❌ Could not find PRODUCTS array in index.html');
  process.exit(1);
}
html = html.replace(productsRe, productsBlock);

// Replace VARIANTS — single-line object literal
const variantsRe = /const VARIANTS\s*=\s*\{[^\n]*\};/;
if (!variantsRe.test(html)) {
  console.error('❌ Could not find VARIANTS object in index.html');
  process.exit(1);
}
html = html.replace(variantsRe, variantsBlock);

fs.writeFileSync(INDEX, html);

// ───── Write data/products.json (slim Stripe-ready) ─────
fs.mkdirSync(path.dirname(OUT_PROD), { recursive: true });
const slimProducts = products.map(p => ({
  id: p.id,
  name: p.name,
  price: p.price,
  image: p.image || '',
}));
fs.writeFileSync(OUT_PROD, JSON.stringify(slimProducts, null, 2));

// ───── Write data/variant-prices.clean.json (server variant validation) ─────
const variantsForServer = {};
for (const p of products) {
  variantsForServer[String(p.id)] = (p.variants || []).map(v => ({
    n: v.name,
    p: typeof v.price === 'number' ? v.price : 0,
    a: !!v.available,
    i: v.image || '',
  }));
}
fs.writeFileSync(OUT_VAR, JSON.stringify(variantsForServer, null, 2));

console.log(
  `✅ Built ${products.length} products → index.html, data/products.json, data/variant-prices.clean.json`
);
