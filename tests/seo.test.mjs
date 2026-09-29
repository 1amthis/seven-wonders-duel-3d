// Static SEO checks on the generated page shell (site.mjs) and the files in public/. No browser or build needed.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { shell, sitemap, SITE_URL, TITLE, DESCRIPTION } from '../site.mjs';

const pub = f => new URL(`../public/${f}`, import.meta.url);
const pages = { external: shell('', '', false), inline: shell('', '', true) };
const meta = (html, attr, key) => (html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`)) || [])[1];
const count = (html, re) => (html.match(re) || []).length;
/** width x height of a JPEG (from its SOF marker) */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

for (const [name, html] of Object.entries(pages)) {
  const label = m => `${name}: ${m}`;
  // title and description
  assert.ok(TITLE.length >= 20 && TITLE.length <= 60, label(`title is ${TITLE.length} characters`));
  assert.ok(DESCRIPTION.length >= 70 && DESCRIPTION.length <= 160, label(`description is ${DESCRIPTION.length} characters`));
  assert.ok(html.includes(`<title>${TITLE}</title>`), label('title tag'));
  assert.equal(meta(html, 'name', 'description'), DESCRIPTION, label('meta description'));
  assert.ok(html.includes('<html lang="en">'), label('lang attribute'));
  assert.ok(!/<meta name="robots"[^>]*noindex/i.test(html), label('page must stay indexable'));
  // canonical and social tags
  assert.ok(SITE_URL.startsWith('https://') && SITE_URL.endsWith('/'), 'SITE_URL is absolute https with a trailing slash');
  assert.ok(html.includes(`<link rel="canonical" href="${SITE_URL}">`), label('canonical'));
  assert.equal(meta(html, 'property', 'og:url'), SITE_URL, label('og:url'));
  for (const key of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:site_name']) assert.ok(meta(html, 'property', key), label(key));
  for (const key of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) assert.ok(meta(html, 'name', key), label(key));
  assert.equal(meta(html, 'property', 'og:image'), meta(html, 'name', 'twitter:image'), label('og and twitter images match'));
  // viewport must not block pinch-zoom
  const viewport = meta(html, 'name', 'viewport');
  assert.ok(viewport && !/maximum-scale|user-scalable/i.test(viewport), label(`viewport blocks zoom: ${viewport}`));
  // crawlable text: one h1, several h2, real words
  assert.equal(count(html, /<h1[ >]/g), 1, label('exactly one <h1>'));
  assert.ok(count(html, /<h2[ >]/g) >= 3, label('at least three <h2>'));
  const about = html.match(/<main class="about">([\s\S]*?)<\/main>/)?.[1] ?? '';
  const words = about.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 200, label(`only ${words} words of crawlable text`));
  assert.ok(/<canvas id="stage"[^>]*aria-label="[^"]+"/.test(html), label('canvas needs an accessible name'));
  // structured data
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  assert.ok(ld && ld['@context'] === 'https://schema.org' && ld['@type'] === 'VideoGame' && ld.name && ld.url === SITE_URL, label('JSON-LD'));
}

// the two variants must agree on everything a crawler reads
assert.equal(pages.external.match(/<main class="about">[\s\S]*<\/main>/)[0], pages.inline.match(/<main class="about">[\s\S]*<\/main>/)[0]);

// icons: files exist and the multi-file page links them, the single-file page inlines one
for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og-image.jpg']) assert.ok(existsSync(pub(f)), `public/${f} is missing`);
for (const href of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) assert.ok(pages.external.includes(`href="${href}"`), `page must link ${href}`);
assert.ok(/<link rel="icon" href="data:image\/svg\+xml,/.test(pages.inline) && !pages.inline.includes('href="favicon'), 'single-file build must inline its icon');
const ico = readFileSync(pub('favicon.ico'));
assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'favicon.ico header');
assert.ok(ico.readUInt16LE(4) >= 1 && ico[6] > 0, 'favicon.ico has entries');
const apple = readFileSync(pub('apple-touch-icon.png'));
assert.deepEqual([apple.readUInt32BE(16), apple.readUInt32BE(20)], [180, 180], 'apple-touch-icon is 180x180');

// link-preview image: served from public/, and the declared size is the real size
const ogPath = pages.external.match(/property="og:image" content="([^"]+)"/)[1].replace(SITE_URL, '');
assert.ok(existsSync(pub(ogPath)), `og:image ${ogPath} must exist in public/`);
const [w, h] = jpegSize(readFileSync(pub(ogPath)));
assert.equal(String(w), meta(pages.external, 'property', 'og:image:width'), 'og:image:width');
assert.equal(String(h), meta(pages.external, 'property', 'og:image:height'), 'og:image:height');
assert.ok(readFileSync(pub(ogPath)).length < 5 * 1024 * 1024, 'og:image under 5 MB');

// sitemap
const sm = sitemap();
assert.ok(sm.startsWith('<?xml') && sm.includes(`<loc>${SITE_URL}</loc>`) && sm.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'sitemap');

console.log('seo tests passed');
