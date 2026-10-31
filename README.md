https://liminal-stemsplit.onrender.com/

## Try in-browser stem splitting (live preview)

**https://liminal-browser-split.vercel.app/** — a separate Vercel preview project built from this branch (static files only; the production Render site is untouched, `main` is unchanged).

* The page shows a live progress experience while you wait: one stepper (Read audio → Get model → Start engine → Separate → Done), model download bytes / MB/s / ETA, chunk x of y, a live waveform of your track you can scrub, stems that light up as they are produced (tap one to hear an early preview), and rotating mixing tips. Leaving the tab is guarded (`beforeunload`), the tab title shows the %, an optional "notify me when done" toggle asks for notification permission only when you tick it, and downloads resume from OPFS if you do leave.
* Preview hosting: `scripts/stage-stem-demo.mjs` stages `public/browser-split.html` + `public/roformer-web` into `dist-stem-demo/`; `vercel-stem-demo/vercel.json` sets COOP `same-origin` / COEP `credentialless`, `noindex`, wasm caching, and redirects the other site paths to the Render site. Redeploy: `node scripts/stage-stem-demo.mjs && cd dist-stem-demo && vercel link --project liminal-browser-split --scope nodawlabs --yes && vercel deploy --prod --yes --scope nodawlabs`.
