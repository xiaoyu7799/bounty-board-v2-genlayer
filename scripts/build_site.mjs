// Bundle the frontend for GitHub Pages (static files only).
// Usage: node scripts/build_site.mjs
import fs from 'node:fs';
import * as esbuild from 'esbuild';

fs.mkdirSync('dist', { recursive: true });
await esbuild.build({
  entryPoints: ['site/src/app.js'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/app.js',
  sourcemap: false,
  logLevel: 'info',
});
fs.copyFileSync('site/src/styles.css', 'dist/styles.css');
console.log('site built: dist/app.js, dist/styles.css');
