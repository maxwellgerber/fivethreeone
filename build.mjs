// Build: bundles src/main.ts + style.css into dist/, copies public/, embeds history if present.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const single = process.argv.includes('--single'); // one self-contained HTML file (for previews)
mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'], outfile: 'dist/app.js', logLevel: 'error' });
cpSync('public', 'dist', { recursive: true });
cpSync('src/style.css', 'dist/app.css');

let html = readFileSync('dist/index.html', 'utf8');
const seed = existsSync('public-history.json') ? readFileSync('public-history.json', 'utf8') : null;
if (seed && process.argv.includes('--seed')) {
  html = html.replace('<script src="./app.js">', () => `<script type="application/json" id="seed-history">${seed.replace(/<\//g, '<\\/')}</script>\n<script src="./app.js">`);
}
writeFileSync('dist/index.html', html);

if (single) {
  const js = readFileSync('dist/app.js', 'utf8');
  const css = readFileSync('dist/app.css', 'utf8');
  let page = html
    .replace('<link rel="stylesheet" href="./app.css">', () => `<style>${css}</style>`)
    .replace('<script src="./app.js"></script>', () => `<script>${js.replace(/<\/script/g, '<\\/script')}</script>`)
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
    .replace(/<link rel="icon"[^>]*>\n?/, '');
  writeFileSync('dist/single.html', page);
  // Artifact variant: body content only (the host supplies the document skeleton).
  const inner = page.replace(/^[\s\S]*?<head>/, '').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<meta charset[^>]*>\n?/, '').replace(/<meta name="viewport"[^>]*>\n?/, '');
  writeFileSync('dist/artifact.html', inner);
}
console.log('built dist/');
