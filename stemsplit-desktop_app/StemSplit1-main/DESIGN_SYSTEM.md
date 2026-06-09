# StemSplit Design System v1.2

> **The "Cyber-HUD" Design Language**  
> A dark, audio-production-focused aesthetic inspired by reactor interfaces, holographic displays, and vintage synthesizer panels.

---

## 1. COLOR PALETTE

### Core Background Colors
```
--background-deep:    #020617   (slate-950) — Primary app background
--background-surface: #0f172a   (slate-900) — Cards, panels, modals
--background-overlay: #0f172a/90 — Backdrop-blurred overlays
```

### Accent Hierarchy
|       Role       | Color   |    Hex    | Tailwind      | Usage |
|                  |---------|-----------|---------------|-------|
| **Primary**      | Cyan    | `#22d3ee` | `cyan-400`    | Main interactions, progress, highlights |
| **Primary Dark** | Cyan    | `#06b6d4` | `cyan-500`    | Active states, borders |
| **Primary Tint** | Cyan    | `#164e63` | `cyan-900`    | Subtle backgrounds, border tints |
| **Success**      | Emerald | `#10b981` | `emerald-500` | Completion, purity scores |
| **Error**        | Red     | `#ef4444` | `red-500`     | Errors, destructive |
| **Warning**      | Orange  | `#f97316` | `orange-500`  | Cautions, drumsep highlights |

### Stem Color System (Per-Stem Identification)
```typescript
const stemColors = {
    vocals:       '#a78bfa'  // purple-400
    drums:        '#f87171'  // red-400
    bass:         '#60a5fa'  // blue-400
    other:        '#facc15'  // yellow-400
    piano:        '#e879f9'  // fuchsia-400
    guitar:       '#fb923c'  // orange-400
    kick:         '#ef4444'  // red-500
    snare:        '#fbbf24'  // amber-400
    toms:         '#818cf8'  // indigo-400
    cymbals:      '#7dd3fc'  // sky-400
    instrumental: '#34d399'  // emerald-400
}
```

### Text Colors
```
--text-primary:   #e2e8f0  (slate-200)  — Main readable text
--text-secondary: #94a3b8  (slate-400)  — Labels, secondary info
--text-muted:     #64748b  (slate-500)  — Hints, timestamps
--text-dim:       #475569  (slate-600)  — Disabled, ultra-subtle
```

### Glow Effects (Box Shadows)
```css
/* Cyan primary glow */
shadow-[0_0_10px_rgba(34,211,238,0.3)]    /* Subtle */
shadow-[0_0_15px_rgba(34,211,238,0.5)]    /* Medium - processing */
shadow-[0_0_20px_rgba(34,211,238,0.8)]    /* Intense - hover/active */

/* Success glow */
shadow-[0_0_10px_rgba(16,185,129,0.2)]    /* Purity badge */
shadow-[0_0_15px_rgba(16,185,129,0.5)]    /* Completion */

/* Error glow */
shadow-[0_0_8px_rgba(248,113,113,0.5)]    /* Red warning */
```

---

## 2. TYPOGRAPHY

### Font Stack (Priority Order)
```css
--font-mono:    'JetBrains Mono', monospace    /* Primary - all UI */
--font-tech:    'Rajdhani', sans-serif          /* Headers, bold tech */
--font-minimal: 'Manrope', sans-serif           /* Clean labels */
--font-display: 'Syncopate', sans-serif         /* STEM SPLIT titles */
```

### Font Sizes
|   Size   | Tailwind        |   Usage |
|----------|-----------------|-------------------|
| `9px`    | `text-[9px]`    | Micro labels, hints, elapsed timers |
| `10px`   | `text-[10px]`   | Secondary info, warnings |
| `11px  ` | `text-[11px]`   | Small body text |
| `12px`   | `text-xs`       | Standard UI text, buttons |
| `14px`   | `text-sm`       | Modal body text |
| `2.8rem` | `text-[2.8rem]` | "STEM" / "SPLIT" display titles |

### Text Treatments
```css
/* Glowing text (for active/highlight states) */
.text-shadow-glow {
    text-shadow: 0 0 10px rgba(34, 211, 238, 0.5),
                 0 0 20px rgba(34, 211, 238, 0.3);
}

/* 3D extruded text (main titles) */
text-shadow: 0 1px 0 #94a3b8,
             0 2px 0 #64748b,
             0 3px 0 #475569,
             0 4px 6px rgba(0,0,0,0.6),
             0 0 20px rgba(34,211,238,0.15);

/* Tracking / Letter-spacing */
tracking-[0.2em]   — LED labels, status
tracking-[0.3em]   — Section headers
tracking-[0.75em]  — Display titles (STEM SPLIT)
```

---

## 3. SPACING & LAYOUT

### Base Spacing Scale
```
4px   (p-1, gap-1)   — Tight internal
8px   (p-2, gap-2)   — Standard internal
12px  (p-3, gap-3)   — Card padding
16px  (p-4, gap-4)   — Section spacing
24px  (p-6, gap-6)   — Modal/large card padding
32px  (p-8, gap-8)   — Major section gaps
```

### Common Dimensions
```
Title Bar:        h-10 (40px)
Drop Zone:        h-40 (idle), h-28 (processing), h-14 (complete)
Modal Width:      max-w-md (448px standard), max-w-2xl (672px analysis)
Stem Player:      Full width, 48px waveform height
Button Height:    py-2 (standard), py-3 (emphasized)
```

---

## 4. BORDER & RADIUS

### Border Widths
```
border (1px)         — Standard panels, cards
border-2 (2px)       — Drop zones (dashed)
border-b (1px)       — Title bar separator
```

### Border Styles
```css
/* Standard panel border */
border border-slate-700

/* Active/focused border */
border border-cyan-500/30

/* Dashed drop zone */
border-2 border-dashed border-slate-700/50

/* Modal border */
border border-cyan-900/50

/* Error state */
border border-red-500/30
```

### Border Radius
```
rounded          — 4px  (buttons, inputs)
rounded-lg       — 8px  (cards, drop zones)
rounded-xl       — 12px (modals, larger panels)
rounded-2xl      — 16px (analysis report modal)
rounded-full     — Circular (LED indicators, close buttons)
```

---

## 5. COMPONENT PATTERNS

### Buttons

**Primary Action (Cyan)**
```tsx
className="px-6 py-2 bg-cyan-900 border border-cyan-500 rounded
           text-cyan-50 hover:bg-cyan-800 transition-colors font-bold
           shadow-lg shadow-cyan-900/50"
```

**Secondary Action (Slate)**
```tsx
className="px-4 py-2 border border-slate-700 rounded
           text-slate-300 hover:bg-slate-800 transition-colors"
```

**Ghost/Text Button**
```tsx
className="text-[9px] font-mono text-slate-600 hover:text-red-400
           transition-colors tracking-wider uppercase"
// e.g. [ CANCEL ]
```

**Config Button**
```tsx
className="px-4 py-2 border border-slate-700 text-slate-400
           hover:text-cyan-400 hover:border-cyan-800 rounded
           font-mono text-xs transition-colors"
// e.g. [ CONFIG OPTIONS ]
```

### Form Inputs

**Select Dropdown**
```tsx
className="w-full bg-slate-950 border border-slate-700 rounded p-2
           text-cyan-50 focus:border-cyan-500 outline-none"
```

**Text Input**
```tsx
className="w-full bg-slate-950 border border-slate-700 rounded p-2
           text-slate-400 text-xs"
```

**Range Slider**
```css
.slider::-webkit-slider-thumb {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e2e8f0;
    border: 1px solid rgba(34, 211, 238, 0.3);
    box-shadow: 0 0 4px rgba(34, 211, 238, 0.3);
}
```

### Cards & Panels

**Standard Card**
```tsx
className="bg-slate-900 border border-slate-700/50 rounded-xl p-4"
```

**Modal Overlay**
```tsx
// Backdrop
className="fixed inset-0 z-50 flex items-center justify-center
           bg-black/60 backdrop-blur-sm"

// Modal body
className="bg-slate-900 border border-cyan-900/50 rounded-xl p-6
           shadow-2xl shadow-cyan-900/20"
```

**Floating Panel (FX Menu)**
```tsx
className="fixed bottom-24 right-4 w-96 max-h-[80vh]
           bg-slate-900/95 backdrop-blur-xl border border-slate-700/50
           rounded-xl shadow-2xl overflow-hidden"
```

### Status Indicators

**LED Indicator**
```tsx
// Housing
<div className="w-4 h-4 rounded-full border border-slate-700 bg-slate-900">
    // Diode (active)
    <div className="bg-gradient-to-br from-cyan-400 to-cyan-600" />
</div>
// Outer glow (pulsing when active)
<motion.div className="rounded-full blur-md bg-cyan-500"
    animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.5, 1] }}
/>
```

**Purity Badge**
```tsx
className="text-[9px] font-mono text-emerald-400
           bg-emerald-950/50 px-2 py-0.5 rounded
           border border-emerald-500/30
           shadow-[0_0_10px_rgba(16,185,129,0.2)]"
// Content: "95% PURE"
```

**Error Badge**
```tsx
className="px-4 py-2 rounded border border-red-500/30
           bg-red-950/30 backdrop-blur-sm"
// Text: text-red-400
```

---

## 6. ANIMATION PATTERNS

### Timing Functions
```javascript
// Standard spring (buttons, hovers)
{ type: "spring", stiffness: 300, damping: 20 }

// Soft entrance
{ type: "spring", stiffness: 45, damping: 15 }

// Quick feedback
{ duration: 0.1 }

// Smooth transitions
{ duration: 0.3 }

// Entrance animations
{ duration: 0.5 }
```

### Framer Motion Patterns

**Slide In**
```tsx
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0, y: -10 }}
```

**Scale Pop**
```tsx
initial={{ scale: 0.95, y: 20 }}
animate={{ scale: 1, y: 0 }}
exit={{ scale: 0.95, y: 20 }}
```

**Fade**
```tsx
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}
```

**Button Hover**
```tsx
whileHover={{ scale: 1.05 }}
whileTap={{ scale: 0.95 }}
```

### CSS Animations

**Glitch Effect**
```css
@keyframes glitch-1 {
    0%, 50%, 100% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
    10% { clip-path: polygon(0 15%, 100% 15%, 100% 55%, 0 55%); 
          transform: translate(-2px, 2px); }
    /* ...chromatic aberration style glitch... */
}
```

**Pulse/Breathe**
```tsx
animate={{ opacity: [0.8, 1, 0.8] }}
transition={{ duration: 2, repeat: Infinity }}
```

---

## 7. 3D PARTICLE SYSTEM (ALTERNATIVE SHAPES)

### Current Implementation (Sphere)
```typescript
const ParticleSphere = {
    MAX_PARTICLES: 800,
    shape: 'sphere',
    radius: 0.4 + Math.random() * 0.12,
    distribution: 'uniform spherical',
    colors: {
        main: '#22d3ee',  // cyan
        glitchRed: '#ff3355',
        glitchBlue: '#3366ff'
    },
    size: 0.012,
    blending: THREE.AdditiveBlending
}
```

### Alternative Shape Ideas for Ecosystem Apps

**1. Helix / DNA Spiral** (for audio analysis apps)
```typescript
// Double helix particle distribution
for (let i = 0; i < MAX_PARTICLES; i++) {
    const t = (i / MAX_PARTICLES) * Math.PI * 4; // 2 rotations
    const strand = i % 2; // alternate strands
    const radius = 0.3;
    positions[i * 3]     = Math.cos(t + strand * Math.PI) * radius;
    positions[i * 3 + 1] = (t / (Math.PI * 4)) - 0.5; // vertical axis
    positions[i * 3 + 2] = Math.sin(t + strand * Math.PI) * radius;
}
```

**2. Torus / Ring** (for mastering/effects apps)
```typescript
// Torus (donut) distribution
const R = 0.4; // major radius
const r = 0.15; // minor radius (tube thickness)
const theta = Math.random() * Math.PI * 2;
const phi = Math.random() * Math.PI * 2;
positions[i * 3]     = (R + r * Math.cos(phi)) * Math.cos(theta);
positions[i * 3 + 1] = r * Math.sin(phi);
positions[i * 3 + 2] = (R + r * Math.cos(phi)) * Math.sin(theta);
```

**3. Cube / Grid** (for DAW/arrangement apps)
```typescript
// 3D grid distribution
const gridSize = 10; // 10x10x10 = 1000 particles
const spacing = 0.08;
const x = (i % gridSize) * spacing - (gridSize * spacing) / 2;
const y = (Math.floor(i / gridSize) % gridSize) * spacing - (gridSize * spacing) / 2;
const z = Math.floor(i / (gridSize * gridSize)) * spacing - (gridSize * spacing) / 2;
```

**4. Wave / Sound Wave** (for recording apps)
```typescript
// Sine wave plane
const rows = 30;
const cols = 50;
const x = (i % cols) / cols - 0.5;
const z = Math.floor(i / cols) / rows - 0.5;
const y = Math.sin(x * Math.PI * 4) * 0.1 + Math.sin(z * Math.PI * 4) * 0.1;
```

**5. Pyramid / Crystal** (for synthesis apps)
```typescript
// Tetrahedron/pyramid distribution
const faces = [[0,1,2], [0,2,3], [0,3,1], [1,3,2]];
const vertices = [
    [0, 0.5, 0],      // top
    [-0.4, -0.3, -0.3], // base
    [0.4, -0.3, -0.3],
    [0, -0.3, 0.4]
];
// Random point on random face via barycentric coords
```

### Particle Material Settings (Consistent Across Apps)
```typescript
<pointsMaterial
    size={0.012}
    color={mainColor}
    transparent={true}
    opacity={0.7}
    sizeAttenuation={true}
    depthWrite={false}
    blending={THREE.AdditiveBlending}  // Creates glow overlap
/>
```

### RGB Glitch Layer (Keep Consistent)
```typescript
// Always add these two offset layers for chromatic aberration
const glitchOffset = Math.sin(time * 3.7) * 0.01;

// Red-shifted duplicate
<ParticleLayer color="#ff3355" opacity={0.15} offset={[glitchOffset, 0, 0]} />

// Blue-shifted duplicate  
<ParticleLayer color="#3366ff" opacity={0.12} offset={[-glitchOffset, 0, 0]} />
```

---

## 8. SCROLLBAR STYLING

```css
::-webkit-scrollbar {
    width: 8px;
    background: #0f172a;
}

::-webkit-scrollbar-thumb {
    background: #1e293b;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #22d3ee;
    box-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
}
```

---

## 9. Z-INDEX LAYERS

```
z-0    — Background particles, grids
z-10   — Main UI content
z-50   — Modals, overlays
z-[60] — Stacked modals (analysis over config)
z-[9999] — Title bar (always on top)
```

---

## 10. SOUND DESIGN HOOKS

UI sounds are triggered via Howler.js:
```typescript
const sfx = [
    'hover_tick',     // Subtle click on hover
    'hover_core',     // Deeper hover for main elements
    'click_engage',   // Button press confirmation
    'process_start',  // Separation begins
    'success_chime',  // Completion
    'error_buzz',     // Error state
    'stem_active'     // Individual stem finishes
];

// All sounds at 60% volume, WAV format
new Howl({ src: [`/sounds/${name}.wav`], volume: 0.6 });
```

---

## 11. QUICK REFERENCE

### Essential Tailwind Classes for Ecosystem Apps

```tsx
// App container
"min-h-screen bg-slate-950 text-slate-200 font-mono antialiased overflow-hidden"

// Glass panel
"bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-xl"

// Primary button
"bg-cyan-900 border border-cyan-500 text-cyan-50 hover:bg-cyan-800 rounded shadow-lg shadow-cyan-900/50"

// Secondary button
"border border-slate-700 text-slate-300 hover:bg-slate-800 rounded"

// Input field
"bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none"

// Status text
"text-[9px] font-mono uppercase tracking-[0.2em]"

// Glow effect
"shadow-[0_0_15px_rgba(34,211,238,0.5)]"

// Gradient separator line
"h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"
```

---

## CHANGELOG

- **v1.2** — Initial design system documentation
- Particle system shape alternatives documented
- Full color palette with stem-specific colors
- Animation patterns formalized

---

*© NoDAW Studio — Cyber-HUD Design Language*
