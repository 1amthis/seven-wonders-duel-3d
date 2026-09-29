// Build script: bundles src/main.js (+three.js) and src/styles.css into dist/,
// and also emits a single self-contained HTML file that can be opened by double-click.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const watch = process.argv.includes('--watch') || serve;

mkdirSync('dist', { recursive: true });

const SITE_URL = 'https://1amthis.github.io/seven-wonders-duel-3d/';
// A small gold pyramid on a dark tile, inlined as a data URI so the build needs no extra static files.
const FAVICON = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#120d08"/>' +
  '<path d="M32 12 52 46H12z" fill="#d9a441"/><path d="M32 12 52 46H32z" fill="#b8862f"/>' +
  '<path d="M6 50h52v4H6z" fill="#7a5a22"/></svg>');

const shell = (js, css, inline) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Seven Wonders Duel 3D · Free browser board game</title>
<meta name="description" content="Play 7 Wonders Duel in 3D, free in your browser: the full rules, an AI opponent, hot-seat play, procedural miniatures of all twelve wonders and a synthesised soundtrack. No download, no sign-up.">
<meta name="theme-color" content="#120d08">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Seven Wonders Duel 3D">
<meta property="og:title" content="Seven Wonders Duel 3D · Play free in your browser">
<meta property="og:description" content="The two-player card game in 3D: all 73 buildings, twelve wonder miniatures, an AI opponent and a generative soundtrack. Everything is procedural, nothing to download.">
<meta property="og:url" content="${SITE_URL}">
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
${inline ? `<style>${css}</style>` : '<link rel="stylesheet" href="game.css">'}
</head>
<body>
<div id="app">
  <canvas id="stage"></canvas>
  <div id="hud"></div>
  <div id="overlay"></div>
  <div id="loader"><div class="loader-inner"><div class="loader-sun"></div><div class="loader-title">SEVEN WONDERS</div><div class="loader-sub">Raising the monuments…</div></div></div>
</div>
${inline ? `<script>${js.replace(/<\/script>/g, '<\\/script>')}</script>` : '<script src="game.js"></script>'}
</body>
</html>`;

const common = {
  entryPoints: { game: 'src/main.js' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'es2020',
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  logLevel: 'info',
  minify: !watch,
  sourcemap: watch,
  legalComments: 'none',
};

function emit() {
  const js = readFileSync('dist/game.js', 'utf8');
  const css = readFileSync('dist/game.css', 'utf8');
  writeFileSync('dist/index.html', shell(js, css, false));
  writeFileSync('dist/seven-wonders-duel-3d.html', shell(js, css, true));
}

const emitPlugin = {
  name: 'emit-html',
  setup(b) {
    b.onEnd(r => { if (!r.errors.length) { emit(); console.log('[html] emitted dist/index.html + dist/seven-wonders-duel-3d.html'); } });
  },
};

if (watch) {
  const ctx = await esbuild.context({ ...common, plugins: [emitPlugin] });
  await ctx.watch();
  if (serve) {
    const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
    console.log(`Serving on http://localhost:${port}`);
  }
} else {
  await esbuild.build({ ...common, plugins: [emitPlugin] });
}
