// The HTML page shell (head metadata, structured data, crawlable text) and the sitemap.
// Shared by build.mjs and tests/seo.test.mjs so the SEO output can be checked without a full build.
import { readFileSync } from 'node:fs';

export const SITE_URL = 'https://1amthis.github.io/seven-wonders-duel-3d/';
export const REPO_URL = 'https://github.com/1amthis/seven-wonders-duel-3d';
export const TITLE = 'Seven Wonders Duel 3D · Free browser board game';
// Google truncates snippets at roughly 160 characters (tests/seo.test.mjs enforces the limit).
export const DESCRIPTION = 'Play 7 Wonders Duel in 3D, free in your browser: full rules, AI opponent, hot-seat mode and 12 wonder miniatures. No download, no sign-up.';
const SOCIAL_TITLE = 'Seven Wonders Duel 3D · Play free in your browser';

// public/favicon.svg is the source of truth. The single-file build inlines it as a data URI so it works offline.
const FAVICON_SVG = readFileSync(new URL('./public/favicon.svg', import.meta.url), 'utf8').trim();
const FAVICON_DATA_URI = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG);

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: 'Seven Wonders Duel 3D',
  alternateName: '7 Wonders Duel 3D',
  description: DESCRIPTION,
  url: SITE_URL,
  image: SITE_URL + 'og-image.jpg',
  genre: ['Board game', 'Card game', 'Strategy'],
  gamePlatform: 'Web browser',
  playMode: ['SinglePlayer', 'MultiPlayer'],
  numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2 },
  inLanguage: 'en',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  author: { '@type': 'Person', name: '1amthis', url: 'https://github.com/1amthis' },
  isBasedOn: { '@type': 'Game', name: '7 Wonders Duel' },
  sameAs: [REPO_URL],
};

// Plain text for crawlers, screen readers and no-JS visitors. The game is a canvas, so without this the page has no
// headings and almost no words. It is visually hidden while the game runs (.about in src/styles.css) and shown as a
// normal page when scripting is off (see the <noscript> style below).
const ABOUT = `<main class="about">
<h1>Seven Wonders Duel 3D: play 7 Wonders Duel free in your browser</h1>
<p>Seven Wonders Duel 3D is a free, fan-made 3D version of the two-player card game <i>7 Wonders Duel</i>. It runs in your browser, with no download and no sign-up. Draft your wonders, build a city over three Ages and win by military supremacy, scientific supremacy or victory points.</p>
<noscript><p><b>The game itself needs JavaScript and WebGL 2. Please enable JavaScript to play.</b></p></noscript>
<h2>What you can play</h2>
<ul>
<li>The full rules: the wonder draft, the three Age pyramids with face-up and face-down cards, all 73 buildings including the guilds, twelve wonders, ten progress tokens, chain building, trading, the conflict pawn with looting tokens, science pairs and the end scoring.</li>
<li>Three ways to play: against the computer at three difficulty levels (Scribe, Strategos and Pharaoh), against a friend on the same screen, or watching two AIs duel.</li>
<li>Twelve wonder miniatures that rise from their cards when you build them: the Pyramids, the Great Library, the Hanging Gardens, the Colossus, the Temple of Artemis, the Great Lighthouse, the Mausoleum, the Sphinx, the Circus Maximus, Piraeus, the Statue of Zeus and the Appian Way.</li>
<li>Card tooltips that show the full effect, the chain symbols and your exact cost, trading included.</li>
<li>Everything is generated in your browser: the card art, the table, the miniatures and an endless soundtrack. There are no images or audio files to download.</li>
</ul>
<h2>How a game works</h2>
<p>On your turn you take one uncovered card from the pyramid and either construct it, discard it for coins, or use it to build one of your wonders. Military symbols push the conflict pawn toward your rival's capital, and six different science symbols win the game on the spot. Otherwise the player with the most victory points after Age III wins.</p>
<h2>Requirements</h2>
<p>A recent version of Chrome, Edge or Firefox with WebGL 2. On a laptop with integrated graphics, choose Medium or Low graphics quality in Settings.</p>
<h2>About this project</h2>
<p>A fan-made tribute, not affiliated with or endorsed by the publishers of 7 Wonders Duel. The source code is open on <a href="${REPO_URL}">GitHub</a>.</p>
</main>`;

const NOSCRIPT_STYLE = `<noscript><style>html,body{height:auto;overflow:auto}#app{display:none}` +
  `.about{position:static;width:auto;height:auto;max-width:720px;margin:0 auto;padding:6vh 20px;overflow:visible;clip:auto;clip-path:none;white-space:normal;color:#f2e4bc;font-size:20px;line-height:1.5}` +
  `.about h1,.about h2{font-family:'Cinzel',serif;color:#f6dc8c;line-height:1.2}.about a{color:#f0c85a}</style></noscript>`;

export const shell = (js, css, inline) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="#120d08">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Seven Wonders Duel 3D">
<meta property="og:title" content="${SOCIAL_TITLE}">
<meta property="og:description" content="The two-player card game in 3D: all 73 buildings, twelve wonder miniatures, an AI opponent and a generative soundtrack. Everything is procedural, nothing to download.">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}og-image.jpg">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="Seven Wonders Duel 3D: miniature wonders rising from a felt table under a night sky">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${SOCIAL_TITLE}">
<meta name="twitter:description" content="The two-player card game in 3D: all 73 buildings, twelve wonder miniatures, an AI opponent and a generative soundtrack. Nothing to download.">
<meta name="twitter:image" content="${SITE_URL}og-image.jpg">
<meta name="twitter:image:alt" content="Seven Wonders Duel 3D: miniature wonders rising from a felt table under a night sky">
${inline
    ? `<link rel="icon" href="${FAVICON_DATA_URI}">`
    : `<link rel="icon" href="favicon.ico" sizes="48x48">
<link rel="icon" href="favicon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="apple-touch-icon.png">`}
<script type="application/ld+json">${JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c')}</script>
${inline ? `<style>${css}</style>` : '<link rel="stylesheet" href="game.css">'}
${NOSCRIPT_STYLE}
</head>
<body>
<div id="app">
  <canvas id="stage" role="img" aria-label="3D game table of Seven Wonders Duel"></canvas>
  <div id="hud"></div>
  <div id="overlay"></div>
  <div id="loader"><div class="loader-inner"><div class="loader-sun"></div><div class="loader-title">SEVEN WONDERS</div><div class="loader-sub">Raising the monuments…</div></div></div>
</div>
${ABOUT}
${inline ? `<script>${js.replace(/<\/script>/g, '<\\/script>')}</script>` : '<script src="game.js"></script>'}
</body>
</html>`;

export const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}</loc></url>
</urlset>
`;
