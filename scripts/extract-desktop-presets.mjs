#!/usr/bin/env node
// Extracts the Liminal desktop app's FX module catalogue, per-stem chains and presets
// from src/components/StemFXMenu.tsx into plain JSON (no code is executed except the
// object literals, after JSX/TS syntax is stripped, inside a node:vm sandbox).
//
//   node scripts/extract-desktop-presets.mjs <path/to/StemFXMenu.tsx> > desktop-presets.json
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(process.argv[2], 'utf8');
const a = src.indexOf('const ALL_FX_MODULES');
const b = src.indexOf('const QUICK_PRESETS');
if (a < 0 || b < 0) throw new Error('markers not found');
let body = src.slice(a, b);
body = body
  .replace(/^\s*icon:\s*<[^\n]*\/>,?\s*$/gm, '')                // JSX icon props
  .replace(/function resolveFxChainKey[\s\S]*?\n}\n/, '')        // helper fn (typed)
  .replace(/const (\w+): Record<string, [^=]*?> =/g, 'const $1 =') // TS annotations
  .replace(/const (\w+): Record<string, string\[\]> =/g, 'const $1 =')
  .replace(/^const /gm, 'var ');
const ctx = vm.createContext({});
vm.runInContext(body + '\n;this.out={ALL_FX_MODULES:ALL_FX_MODULES,STEM_FX_CHAINS:STEM_FX_CHAINS,STEM_PRESETS:STEM_PRESETS}', ctx);
const out = JSON.parse(JSON.stringify(ctx.out));
for (const m of Object.values(out.ALL_FX_MODULES)) delete m.icon;
for (const list of Object.values(out.STEM_PRESETS)) for (const p of list) delete p.icon;
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
