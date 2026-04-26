/**
 * One-time migration: seeds content/products/{id}.json from the existing
 * inline PRODUCTS array + VARIANTS object in index.html.
 *
 * After this runs, content/products/ becomes the source of truth and the
 * build script (build-catalog.js) regenerates everything else from it.
 *
 * Idempotent — running again just rewrites the same files.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'content', 'products');

const html = fs.readFileSync(INDEX, 'utf-8');

// ───── Pull IMG_PREFIXES, IMG_CODES, IMG_SUFFIX, then re-build imgUrl ─────
function extractBlock(startRe, openCh, closeCh) {
  const m = html.match(startRe);
  if (!m) throw new Error('Missing block for ' + startRe);
  const begin = m.index + m[0].length - 1;
  let d = 0, inS = false, s = '';
  for (let i = begin; i < html.length; i++) {
    const c = html[i];
    if (inS) { if (c === '\\') { i++; continue; } if (c === s) inS = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = true; s = c; continue; }
    if (c === openCh) d++;
    else if (c === closeCh) { d--; if (d === 0) return html.slice(begin, i + 1); }
  }
  throw new Error('Unclosed block');
}

const imgPrefixesSrc = extractBlock(/const IMG_PREFIXES\s*=\s*\{/, '{', '}');
const imgCodesSrc    = extractBlock(/const IMG_CODES\s*=\s*\[/, '[', ']');
const imgSuffixMatch = html.match(/const IMG_SUFFIX\s*=\s*(['"`])([\s\S]*?)\1/);
const imgSuffix = imgSuffixMatch ? imgSuffixMatch[2] : '';

const variantBaseMatch  = html.match(/const VARIANT_IMG_BASE\s*=\s*(['"`])([\s\S]*?)\1/);
const variantBase = variantBaseMatch ? variantBaseMatch[2] : '';
const variantSuffixMatch = html.match(/const VARIANT_SUFFIX\s*=\s*(['"`])([\s\S]*?)\1/);
const variantSuffix = variantSuffixMatch ? variantSuffixMatch[2] : '';

const sandbox = { IMG_SUFFIX: imgSuffix };
vm.createContext(sandbox);
sandbox.IMG_PREFIXES = vm.runInContext('(' + imgPrefixesSrc + ')', sandbox);
sandbox.IMG_CODES    = vm.runInContext(imgCodesSrc, sandbox);
sandbox.imgUrl = function(code) {
  if (!code) return '';
  const [prefix, hash] = code.split(':');
  return (sandbox.IMG_PREFIXES[prefix] || sandbox.IMG_PREFIXES['5']) + hash + sandbox.IMG_SUFFIX;
};

// ───── Pull PRODUCTS ─────
const productsSrc = extractBlock(/const PRODUCTS\s*=\s*\[/, '[', ']');
const products = vm.runInContext(productsSrc, sandbox);

// ───── Pull VARIANTS (single line JSON-ish object) ─────
const variantsSrc = extractBlock(/const VARIANTS\s*=\s*\{/, '{', '}');
const variants = vm.runInContext('(' + variantsSrc + ')', sandbox);

// Resolve variant `i:` hashes to full URLs so the schema is uniform
function resolveVariantImage(i) {
  if (!i) return '';
  if (i.startsWith('http')) return i;
  if (i.startsWith('/'))    return i;     // local /assets/...
  return variantBase + i + variantSuffix; // legacy hash
}

// ───── Write one file per product ─────
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const p of products) {
  const variantArr = variants[String(p.id)] || [];
  const entry = {
    id: p.id,
    name: p.name,
    price: p.price,
    image: p.image,                           // already full URL
    description: '',                          // wife can fill in
    rating: typeof p.rating === 'number' ? p.rating : 5,
    sold: typeof p.sold === 'number' ? p.sold : 0,
    chakra: Array.isArray(p.chakra) ? p.chakra : [],
    // CSV string — matches Decap's tag-style list widget (renders as chips)
    properties: Array.isArray(p.properties) ? p.properties.join(', ') : '',
    variants: variantArr.map(v => ({
      name: v.n,
      price: v.p,
      available: !!v.a,
      image: resolveVariantImage(v.i),
    })),
  };
  const filename = String(p.id).padStart(3, '0') + '.json';
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(entry, null, 2) + '\n');
}

console.log(`✅ Migrated ${products.length} products to ${OUT_DIR}`);
