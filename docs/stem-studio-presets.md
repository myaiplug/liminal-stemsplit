# Stem Studio — preset inventory and fidelity

Generated from public/stem-studio/presets.js. Source of truth for the desktop side: `stemsplit-desktop_app` (`ALL_FX_MODULES`, `STEM_FX_CHAINS`), extracted by `scripts/extract-desktop-presets.mjs` into `public/stem-studio/desktop-data.js`.

## Effect modules

| Module | Name | Fidelity vs desktop | Notes |
|---|---|---|---|
| `gate` | Pro Gate | Same as desktop | JUCE-style expander, stereo-linked (pedalboard detects per channel). |
| `dereverb` | De-Reverb | Same as desktop | Same as desktop: a gate with ratio 1 + amount/10, attack 10 ms. It is an expander, not a spectral de-reverb; use Artifact Cleanup > De-reverb tails for a spectral one. |
| `deesser` | De-Esser | Approximation | Default mode is a split-band de-esser (only the sibilant band is reduced). "Desktop" mode reproduces the desktop hybrid (-3 dB cut at the frequency + 5:1 compressor on the whole signal). |
| `compressor` | Studio Comp | Desktop bug fixed | JUCE compressor law, hard knee, linked. Auto makeup (70 % of static reduction when makeup = 0) + -0.5 dB limiter as on desktop. The desktop ignores the Mix knob; Studio honours it (parallel compression). |
| `eq` | 3-Band EQ | Same as desktop | Low shelf 200 Hz, peak (Q 1) at Mid Freq, high shelf 5 kHz, with the desktop "smart curves" (30 Hz HPF when Low > 3 dB, +25 % air shelf at 12 kHz when High > 2 dB). RBJ biquads like JUCE. |
| `saturation` | Analog Warmth | Desktop bug fixed | 60 Hz head bump -> tanh drive (drive x 0.35 dB) -> -0.3 dB clip -> 14 kHz low-pass. The desktop ignores the Mix knob; Studio honours it. |
| `reverb` | Space Designer | Approximation | Freeverb/JUCE topology and constants, desktop mapping (dry = 1 - wet/2, damping floor 60 % above 60 % room, 300 Hz mud cut when wet > 30 %). Desktop sends the dry gain through JUCE x2 scaling (louder); Studio keeps unity dry. Width above 100 % is clamped (as JUCE). |
| `delay` | Tape Delay | Desktop bug fixed | Same delay/feedback/mix. Desktop puts a 4 kHz low-pass before the delay (dulling the dry signal) when feedback > 40 %; Studio puts it in the feedback loop only (the evident intent). |
| `chorus` | Stereo Chorus | Approximation | Modulated stereo delay (quadrature LFOs). JUCE chorus internals are not published, so depth scaling is matched by ear. |
| `loudness` | Pro Maximizer | Same as desktop | Same flow as desktop: input gain -> 20:1 compressor at the ceiling (1 ms / 100 ms) -> hard clip at the ceiling. Not a true-peak limiter: Export applies a true-peak safe stage. |
| `stereo-width` | Stereo Widener | Desktop bug fixed | Mid/side with the side high-passed at 120 Hz (bass stays mono), side x width, 15 % 10 ms Haas copy above 120 %. Runs in chain position (desktop applies it after the whole chain). The Haas copy uses a true delay line (desktop wraps with np.roll). |
| `filter` | DJ Filter | Same as desktop | First-order (6 dB/oct) HP when > 20 Hz and LP when < 19 kHz, like pedalboard. |
| `phaser` | Jet Phaser | Desktop bug fixed | 6-stage all-pass phaser around 1.3 kHz. The desktop passes preset mix values such as 40 straight to a 0-1 parameter, which makes pedalboard throw and silently drop the phaser; Studio treats values > 1 as percent. |
| `pitch` | Pitch Shifter | Approximation | Phase-vocoder pitch shift (fft 2048, 8x overlap, ~37 ms latency, compensated). pedalboard uses Rubber Band (GPL); expect more phasiness on vocals at +-12. |
| `peq` | Parametric Band | Studio-only | Parametric band: peak / low shelf / high shelf / first-order or 12 dB/oct HP/LP / notch. |
| `gain` | Gain | Studio-only | Plain gain. |
| `limiter` | Limiter | Studio-only | Look-ahead brick-wall limiter (1.5 ms). |
| `drive` | Drive | Studio-only | tanh drive (Classic presets). |
| `bitcrush` | Bitcrush | Studio-only | Bit-depth reduction (Classic presets). |

Fidelity legend: **Same as desktop** = same algorithm/constants; **Desktop bug fixed** = the desktop chain does something unintended (ignored Mix knob, pedalboard exceptions swallowed, etc.) and Studio does the evident intent; **Approximation** = desktop uses a closed engine (JUCE Reverb/Chorus, Rubber Band) and Studio matches by ear/measurement; **Studio-only** = no desktop equivalent.

## Presets per stem type (156 total over 15 stem types)

### vocals (10)

- desktop — Lead Vocal
- desktop — Telephone
- desktop — High Pitch
- desktop — Loudness
- studio — Clean-up
- classic — Crystal Clear
- classic — Studio Presence
- classic — Lush Verb
- classic — Dry Tight
- classic — Broadcast

### drums (10)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### bass (9)

- desktop — Sub Enhance
- desktop — Fuzz Bass
- desktop — Synth Phase
- desktop — Tight & Clean
- classic — Sub Focus
- classic — Fuzz Box
- classic — Even Dynamics
- classic — Note Definition
- classic — Rumble Eater

### other (8)

- desktop — Wide Stereo
- desktop — Octave Down
- desktop — Shimmer
- classic — Stereo Widen
- classic — Warm Tape
- classic — Clean Rhythm
- classic — Shimmer
- classic — Background

### instrumental (8)

- desktop — Wide Stereo
- desktop — Octave Down
- desktop — Shimmer
- classic — Stereo Widen
- classic — Warm Tape
- classic — Clean Rhythm
- classic — Shimmer
- classic — Background

### guitar (8)

- desktop — Wide Stereo
- desktop — Octave Down
- desktop — Shimmer
- classic — Stereo Widen
- classic — Warm Tape
- classic — Clean Rhythm
- classic — Shimmer
- classic — Background

### piano (8)

- desktop — Wide Stereo
- desktop — Octave Down
- desktop — Shimmer
- classic — Stereo Widen
- classic — Warm Tape
- classic — Clean Rhythm
- classic — Shimmer
- classic — Background

### kick (13)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- studio — Punch & Sub
- studio — Tight
- studio — Soft Clip Loud
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### snare (13)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- studio — Snap
- studio — Room Tamer
- studio — Fat
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### hats (13)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- studio — Smooth
- studio — Air
- studio — Tight
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### toms (12)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- studio — Boom
- studio — Tight Gate
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### cymbals (12)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- studio — Tame Wash
- studio — Sparkle
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### ride (10)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### crash (10)

- desktop — Kick Boost
- desktop — Jet Overhead
- desktop — Crushed
- desktop — Wide Kit
- classic — Punchy Kick
- classic — Crisp Snare
- classic — Room Killer
- classic — Bus Glue
- classic — Lofi Grit
- classic — Snare Crack

### sub808 (12)

- desktop — Sub Enhance
- desktop — Fuzz Bass
- desktop — Synth Phase
- desktop — Tight & Clean
- studio — Clean Sub
- studio — Harmonics
- studio — Tight
- classic — Sub Focus
- classic — Fuzz Box
- classic — Even Dynamics
- classic — Note Definition
- classic — Rumble Eater

