// Build script: bundles src/main.js (+three.js) and src/styles.css into dist/,
// and also emits a single self-contained HTML file that can be opened by double-click.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { shell, sitemap } from './site.mjs';

const serve = process.argv.includes('--serve');
const watch = process.argv.includes('--watch') || serve;

mkdirSync('dist', { recursive: true });

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
  writeFileSync('dist/sitemap.xml', sitemap());
  if (existsSync('public')) cpSync('public', 'dist', { recursive: true }); // static files served as-is (link-preview image, favicons)
}

const emitPlugin = {
  name: 'emit-html',
  setup(b) {
    b.onEnd(r => { if (!r.errors.length) { emit(); console.log('[html] emitted dist/index.html + dist/seven-wonders-duel-3d.html + dist/sitemap.xml'); } });
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
