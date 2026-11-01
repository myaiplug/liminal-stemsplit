// Stages the static in-browser stem splitter (no server needed) into dist-stem-demo/ for a SEPARATE Vercel project.
// Usage: node scripts/stage-stem-demo.mjs   then   vercel deploy dist-stem-demo --prod --yes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-stem-demo');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const FILES = ['public/browser-split.html', 'public/browser-split-sw.js', 'public/roformer-web', 'public/assets/liminal.png'];
// Stem Studio (static, no server): staged when present. Model weights (*.onnx) are NEVER staged; host them separately.
const STUDIO = ['public/stem-studio.html', 'public/stem-studio'].filter((r) => fs.existsSync(path.join(root, r)));
FILES.push(...STUDIO);
const skip = (src) => !/\.onnx$/i.test(src) && !src.includes(`${path.sep}__fix`);
for (const rel of FILES) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) { console.error(`missing: ${rel}`); process.exit(1); }
  const dst = path.join(out, rel.replace(/^public\//, ''));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, filter: skip });
}
// On this preview host '/' shows the stem page: let the offline cache answer '/' too.
const swPath = path.join(out, 'browser-split-sw.js');
const swSrc = fs.readFileSync(swPath, 'utf8');
if (!swSrc.includes('ROOT_FALLBACK: false')) { console.error('service worker has no ROOT_FALLBACK flag - run the module sync'); process.exit(1); }
fs.writeFileSync(swPath, swSrc.replace('ROOT_FALLBACK: false', 'ROOT_FALLBACK: true'));
fs.copyFileSync(path.join(root, 'vercel-stem-demo', 'vercel.json'), path.join(out, 'vercel.json'));
let bytes = 0, n = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { bytes += fs.statSync(p).size; n++; } } })(out);
console.log(`staged ${n} files, ${(bytes / 1e6).toFixed(1)} MB -> ${path.relative(root, out)}`);
