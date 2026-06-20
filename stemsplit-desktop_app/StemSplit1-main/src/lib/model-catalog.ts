import { EXTENDED_MODELS } from './model-catalog-extended';

export type SeparationEngine =
  | 'demucs' | 'mdx' | 'roformer' | 'vr' | 'spleeter' | 'drumsep'
  | 'ensemble' | 'karaoke' | 'postfx' | 'instrument';

export type ModelTier = 'S' | 'A' | 'B' | 'specialty';

export type ModelCategory =
  | 'ensemble'
  | 'vocal'
  | 'instrumental'
  | 'karaoke'
  | 'restoration'
  | 'multistem'
  | 'drums'
  | 'fast'
  | 'specialty';

export interface SeparationModel {
  id: string;
  engine: SeparationEngine;
  category: ModelCategory;
  name: string;
  tagline: string;
  description: string;
  filename?: string;
  stems: number[];
  tier: ModelTier;
  accent: string;
  glow: string;
  glyph: string;
  tags: string[];
  recommendedFor: string[];
  speed: 'fast' | 'balanced' | 'slow';
  quality: number;
}

export const ENGINE_META: Record<
  SeparationEngine,
  { label: string; subtitle: string; color: string; glow: string }
> = {
  demucs: {
    label: 'Full Mix',
    subtitle: 'Best for full songs — vocals, drums, bass, other',
    color: '#22d3ee',
    glow: 'rgba(34,211,238,0.35)',
  },
  mdx: {
    label: 'Vocal Pro',
    subtitle: 'Surgical vocal isolation & specialty extraction',
    color: '#a78bfa',
    glow: 'rgba(167,139,250,0.35)',
  },
  roformer: {
    label: 'Vocal Elite',
    subtitle: 'Highest vocal clarity — studio-grade fidelity',
    color: '#f472b6',
    glow: 'rgba(244,114,182,0.35)',
  },
  vr: {
    label: 'Restoration',
    subtitle: 'Clean up noisy audio, karaoke, podcast repair',
    color: '#fb923c',
    glow: 'rgba(251,146,60,0.35)',
  },
  spleeter: {
    label: 'Quick Split',
    subtitle: 'Lightning fast — free tier included',
    color: '#94a3b8',
    glow: 'rgba(148,163,184,0.25)',
  },
  drumsep: {
    label: 'Drum Separator',
    subtitle: 'Split kick, snare, toms, cymbals, hi-hat',
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.35)',
  },
  ensemble: {
    label: 'Multi-Model',
    subtitle: 'Combine engines for maximum quality',
    color: '#e879f9',
    glow: 'rgba(232,121,249,0.4)',
  },
  karaoke: {
    label: 'Karaoke Maker',
    subtitle: 'Remove lead vocal, keep backing track',
    color: '#fda4af',
    glow: 'rgba(253,164,175,0.4)',
  },
  postfx: {
    label: 'Mastering FX',
    subtitle: 'Apollo · Matchering · Transkun polish',
    color: '#34d399',
    glow: 'rgba(52,211,153,0.35)',
  },
  instrument: {
    label: 'Solo Instrument',
    subtitle: 'Extract guitar, piano, strings, brass, choir',
    color: '#a3e635',
    glow: 'rgba(163,230,53,0.35)',
  },
};

export const SEPARATION_MODELS: SeparationModel[] = [
  // ── Demucs ──────────────────────────────────────────────
  {
    id: 'demucs_htdemucs',
    engine: 'demucs',
    category: 'multistem',
    name: 'HTDemucs v4',
    tagline: 'Balanced 4-stem workhorse',
    description:
      'Facebook\'s hybrid transformer Demucs v4. Splits vocals, drums, bass, and other with strong generalization across pop, rock, and electronic. Best default for full multistem sessions.',
    stems: [2, 4, 5, 6],
    tier: 'A',
    accent: '#22d3ee',
    glow: 'rgba(34,211,238,0.4)',
    glyph: '◈',
    tags: ['multistem', 'general'],
    recommendedFor: ['full mixes', 'production', 'remixes'],
    speed: 'balanced',
    quality: 82,
  },
  {
    id: 'demucs_htdemucs_ft',
    engine: 'demucs',
    category: 'fast',
    name: 'HTDemucs Fine-Tuned',
    tagline: 'Faster passes, slightly lighter',
    description:
      'Fine-tuned variant optimized for speed. Trades a small amount of bleed rejection for noticeably faster inference — ideal for batch processing long libraries.',
    stems: [2, 4],
    tier: 'B',
    accent: '#06b6d4',
    glow: 'rgba(6,182,212,0.35)',
    glyph: '⚡',
    tags: ['fast', 'batch'],
    recommendedFor: ['bulk jobs', 'previews', 'DJ crates'],
    speed: 'fast',
    quality: 76,
  },
  {
    id: 'demucs_htdemucs_6s',
    engine: 'demucs',
    category: 'multistem',
    name: 'HTDemucs 6-Stem',
    tagline: 'Guitar + piano isolation',
    description:
      'Extended 6-source model separating vocals, drums, bass, piano, guitar, and other. The go-to when you need melodic instruments as individual stems for arrangement or sampling.',
    stems: [6],
    tier: 'A',
    accent: '#38bdf8',
    glow: 'rgba(56,189,248,0.4)',
    glyph: '⬡',
    tags: ['6-stem', 'guitar', 'piano'],
    recommendedFor: ['acoustic tracks', 'band mixes', 'sampling'],
    speed: 'slow',
    quality: 80,
  },

  // ── MDX MVSEP + ONNX ────────────────────────────────────
  {
    id: 'mdx23_ensemble',
    engine: 'mdx',
    category: 'ensemble',
    name: 'MDX23 Ensemble',
    tagline: 'MVSEP multi-model fusion',
    description:
      'Full MVSEP-MDX23 ensemble combining multiple MDX and Demucs passes. Highest overall fidelity for 2-stem and 4-stem extraction with aggressive bleed control on vocals.',
    stems: [2, 4],
    tier: 'S',
    accent: '#c084fc',
    glow: 'rgba(192,132,252,0.45)',
    glyph: '✦',
    tags: ['ensemble', 'quality'],
    recommendedFor: ['masters', 'vocals', 'critical work'],
    speed: 'slow',
    quality: 94,
  },
  {
    id: 'mdx_kim_vocal_2',
    engine: 'mdx',
    category: 'vocal',
    name: 'Kim Vocal 2',
    tagline: 'Community-favorite vocal isolator',
    filename: 'Kim_Vocal_2.onnx',
    description:
      'Kimberley Jensen\'s MDX-Net vocal model. Exceptional at preserving breath, consonants, and stereo width while removing instrument bleed. Industry standard for acapella extraction.',
    stems: [2],
    tier: 'S',
    accent: '#e879f9',
    glow: 'rgba(232,121,249,0.45)',
    glyph: '♪',
    tags: ['vocal', 'acapella'],
    recommendedFor: ['acapellas', 'vocal chops', 'remix stems'],
    speed: 'balanced',
    quality: 92,
  },
  {
    id: 'mdx_voc_ft',
    engine: 'mdx',
    category: 'vocal',
    name: 'MDX Voc FT',
    tagline: 'Fine-tuned vocal extractor',
    filename: 'UVR-MDX-NET-Voc_FT.onnx',
    description:
      'Fine-tuned MDX vocal model with emphasis on lead vocal clarity in dense mixes. Handles layered harmonies and doubles with minimal phasing artifacts.',
    stems: [2],
    tier: 'A',
    accent: '#d8b4fe',
    glow: 'rgba(216,180,254,0.4)',
    glyph: '◎',
    tags: ['vocal', 'lead'],
    recommendedFor: ['pop vocals', 'dense mixes'],
    speed: 'balanced',
    quality: 88,
  },
  {
    id: 'mdx_inst_hq_1',
    engine: 'mdx',
    category: 'instrumental',
    name: 'Inst HQ v1',
    tagline: 'Clean instrumental backing',
    filename: 'UVR-MDX-NET-Inst_HQ_1.onnx',
    description:
      'High-quality instrumental model focused on removing vocals while retaining punch, stereo imaging, and high-frequency detail in the backing track.',
    stems: [2],
    tier: 'A',
    accent: '#818cf8',
    glow: 'rgba(129,140,248,0.4)',
    glyph: '◇',
    tags: ['instrumental', 'backing'],
    recommendedFor: ['karaoke prep', 'instrumentals', 'sync licensing'],
    speed: 'balanced',
    quality: 87,
  },
  {
    id: 'mdx_inst_hq_3',
    engine: 'mdx',
    category: 'instrumental',
    name: 'Inst HQ v3',
    tagline: 'Refined backing extraction',
    filename: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    description:
      'Third-generation instrumental HQ model with improved handling of reverb tails and vocal ad-libs. Produces cleaner minus-one tracks for live performance.',
    stems: [2],
    tier: 'A',
    accent: '#6366f1',
    glow: 'rgba(99,102,241,0.4)',
    glyph: '◆',
    tags: ['instrumental', 'live'],
    recommendedFor: ['live backing', 'minus-one'],
    speed: 'balanced',
    quality: 89,
  },
  {
    id: 'mdx_kara',
    engine: 'mdx',
    category: 'karaoke',
    name: 'MDX Karaoke',
    tagline: 'Lead-vocal karaoke split',
    filename: 'UVR_MDXNET_KARA.onnx',
    description:
      'Karaoke-specialized MDX model that removes lead vocals while preserving backing vocals and choir parts. Perfect for sing-along and karaoke authoring.',
    stems: [2],
    tier: 'A',
    accent: '#f0abfc',
    glow: 'rgba(240,171,252,0.4)',
    glyph: '☆',
    tags: ['karaoke', 'backing-vocals'],
    recommendedFor: ['karaoke', 'sing-along', 'cover tracks'],
    speed: 'balanced',
    quality: 86,
  },
  {
    id: 'mdx_kara_2',
    engine: 'mdx',
    category: 'karaoke',
    name: 'MDX Karaoke v2',
    tagline: 'Improved backing-vocal retention',
    filename: 'UVR_MDXNET_KARA_2.onnx',
    description:
      'Updated karaoke model with better separation of lead vs. harmony vocals. Reduces lead bleed in the instrumental while keeping ad-libs and choir intact.',
    stems: [2],
    tier: 'A',
    accent: '#e879f9',
    glow: 'rgba(232,121,249,0.4)',
    glyph: '★',
    tags: ['karaoke', 'harmonies'],
    recommendedFor: ['duets', 'choir tracks', 'gospel'],
    speed: 'balanced',
    quality: 87,
  },
  {
    id: 'mdx_crowd_hq',
    engine: 'mdx',
    category: 'specialty',
    name: 'Crowd HQ',
    tagline: 'Audience & crowd noise isolation',
    filename: 'UVR-MDX-NET_Crowd_HQ_1.onnx',
    description:
      'Specialty model for separating crowd/audience ambience from main program audio. Useful for live recordings, sports broadcast cleanup, and field recording.',
    stems: [2],
    tier: 'specialty',
    accent: '#a3e635',
    glow: 'rgba(163,230,53,0.35)',
    glyph: '▣',
    tags: ['crowd', 'live', 'ambience'],
    recommendedFor: ['live events', 'field recording', 'broadcast'],
    speed: 'balanced',
    quality: 84,
  },
  {
    id: 'mdx_reverb_hq',
    engine: 'mdx',
    category: 'restoration',
    name: 'Reverb HQ',
    tagline: 'De-reverb & wet/dry split',
    filename: 'Reverb_HQ_By_FoxJoy.onnx',
    description:
      'FoxJoy\'s reverb separation model. Extracts dry source from wet, reverberant recordings — invaluable for cleaning room sound from vocals and dialogue.',
    stems: [2],
    tier: 'specialty',
    accent: '#67e8f9',
    glow: 'rgba(103,232,249,0.35)',
    glyph: '∿',
    tags: ['reverb', 'restoration', 'dry'],
    recommendedFor: ['roomy vocals', 'podcast cleanup', 'archival'],
    speed: 'balanced',
    quality: 83,
  },
  {
    id: 'mdx23c_hq',
    engine: 'mdx',
    category: 'ensemble',
    name: 'MDX23C HQ',
    tagline: '8K FFT high-res checkpoint',
    filename: 'MDX23C-8KFFT-InstVoc_HQ.ckpt',
    description:
      'MDX23C checkpoint with 8K FFT resolution for maximum spectral detail. Exceptional vocal/instrumental boundary precision on complex, dense arrangements.',
    stems: [2],
    tier: 'S',
    accent: '#c084fc',
    glow: 'rgba(192,132,252,0.5)',
    glyph: '✧',
    tags: ['hq', 'checkpoint', '8k-fft'],
    recommendedFor: ['complex mixes', 'orchestral', 'metal'],
    speed: 'slow',
    quality: 93,
  },

  // ── Roformer ────────────────────────────────────────────
  {
    id: 'roformer_melband',
    engine: 'roformer',
    category: 'vocal',
    name: 'MelBand Roformer',
    tagline: 'Kimberley Jensen — S-tier vocals',
    filename: 'vocals_mel_band_roformer.ckpt',
    description:
      'Mel-band Roformer vocals model (Kimberley Jensen). State-of-the-art 2-stem fidelity. Auto-downloads or uses your local MelBandRoformer.ckpt from AudioSeperationModels.',
    stems: [2],
    tier: 'S',
    accent: '#f472b6',
    glow: 'rgba(244,114,182,0.5)',
    glyph: '❋',
    tags: ['roformer', 'vocal', 'sota'],
    recommendedFor: ['acapellas', 'critical vocal work'],
    speed: 'slow',
    quality: 96,
  },
  {
    id: 'roformer_bs_317',
    engine: 'roformer',
    category: 'multistem',
    name: 'Studio Vocals',
    tagline: 'Professional vocal isolation',
    filename: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
    description:
      'Band-split Roformer checkpoint (epoch 317, SDR 12.97). 4-stem separation with transformer attention across frequency bands for ultra-clean multistem output.',
    stems: [4],
    tier: 'S',
    accent: '#ec4899',
    glow: 'rgba(236,72,153,0.45)',
    glyph: '◉',
    tags: ['roformer', '4-stem'],
    recommendedFor: ['multistem', 'high-end production'],
    speed: 'slow',
    quality: 95,
  },

  // ── VR Architecture ─────────────────────────────────────
  {
    id: 'vr_hp_vocal_4',
    engine: 'vr',
    category: 'vocal',
    name: 'HP Vocal v4',
    tagline: 'High-pass vocal isolation',
    filename: '4_HP-Vocal-UVR.pth',
    description:
      'UVR HP (high-pass) vocal model v4. Sharp vocal extraction with high-frequency emphasis — excellent for EDM, hip-hop, and bright vocal productions.',
    stems: [2],
    tier: 'A',
    accent: '#fb923c',
    glow: 'rgba(251,146,60,0.4)',
    glyph: '△',
    tags: ['vocal', 'hp'],
    recommendedFor: ['EDM', 'hip-hop', 'bright vocals'],
    speed: 'balanced',
    quality: 88,
  },
  {
    id: 'vr_hp_vocal_3',
    engine: 'vr',
    category: 'vocal',
    name: 'HP Vocal v3',
    tagline: 'Classic high-pass vocal net',
    filename: '3_HP-Vocal-UVR.pth',
    description:
      'Earlier HP vocal architecture. Slightly faster than v4 with a warmer vocal character. Good for soul, R&B, and vintage-recorded vocals.',
    stems: [2],
    tier: 'B',
    accent: '#fdba74',
    glow: 'rgba(253,186,116,0.35)',
    glyph: '▽',
    tags: ['vocal', 'vintage'],
    recommendedFor: ['soul', 'R&B', 'retro'],
    speed: 'fast',
    quality: 84,
  },
  {
    id: 'vr_hp2',
    engine: 'vr',
    category: 'vocal',
    name: 'HP2-UVR',
    tagline: 'Second-gen high-pass net',
    filename: '7_HP2-UVR.pth',
    description:
      'HP2 architecture with improved mid-range vocal retention. Balances brightness and body for pop and rock lead vocals.',
    stems: [2],
    tier: 'A',
    accent: '#f97316',
    glow: 'rgba(249,115,22,0.4)',
    glyph: '◁',
    tags: ['vocal', 'pop'],
    recommendedFor: ['pop', 'rock', 'indie'],
    speed: 'balanced',
    quality: 86,
  },
  {
    id: 'vr_karaoke_5',
    engine: 'vr',
    category: 'karaoke',
    name: 'HP Karaoke v5',
    tagline: 'Lead vocal removal — karaoke',
    filename: '5_HP-Karaoke-UVR.pth',
    description:
      'HP karaoke model v5. Strips lead vocals while preserving instrumental and backing vocal energy. Standard choice for karaoke track authoring.',
    stems: [2],
    tier: 'A',
    accent: '#fda4af',
    glow: 'rgba(253,164,175,0.4)',
    glyph: '♫',
    tags: ['karaoke'],
    recommendedFor: ['karaoke', 'covers'],
    speed: 'balanced',
    quality: 85,
  },
  {
    id: 'vr_karaoke_6',
    engine: 'vr',
    category: 'karaoke',
    name: 'HP Karaoke v6',
    tagline: 'Refined karaoke separation',
    filename: '6_HP-Karaoke-UVR.pth',
    description:
      'Latest HP karaoke iteration with tighter lead vocal rejection and cleaner instrumental output. Better harmony retention than v5.',
    stems: [2],
    tier: 'A',
    accent: '#fb7185',
    glow: 'rgba(251,113,133,0.4)',
    glyph: '♬',
    tags: ['karaoke', 'harmonies'],
    recommendedFor: ['duet karaoke', 'choir backing'],
    speed: 'balanced',
    quality: 87,
  },
  {
    id: 'vr_mgm_main',
    engine: 'vr',
    category: 'multistem',
    name: 'MGM Main v4',
    tagline: 'Multi-genre main stem split',
    filename: 'MGM_MAIN_v4.pth',
    description:
      'MGM (multi-genre model) main architecture. Versatile vocal/instrumental split trained across diverse genres for consistent all-purpose results.',
    stems: [2],
    tier: 'A',
    accent: '#fbbf24',
    glow: 'rgba(251,191,36,0.4)',
    glyph: '◐',
    tags: ['mgm', 'general'],
    recommendedFor: ['mixed libraries', 'unknown genre'],
    speed: 'balanced',
    quality: 86,
  },
  {
    id: 'vr_mgm_highend',
    engine: 'vr',
    category: 'vocal',
    name: 'MGM High-End v4',
    tagline: 'High-frequency vocal precision',
    filename: 'MGM_HIGHEND_v4.pth',
    description:
      'MGM variant optimized for high-end frequency content. Captures air, sibilance, and breath without harsh artifacts — ideal for mastered material.',
    stems: [2],
    tier: 'A',
    accent: '#fde047',
    glow: 'rgba(253,224,71,0.35)',
    glyph: '◑',
    tags: ['mgm', 'highend'],
    recommendedFor: ['mastered tracks', 'audiophile'],
    speed: 'balanced',
    quality: 88,
  },
  {
    id: 'vr_mgm_lowend_a',
    engine: 'vr',
    category: 'vocal',
    name: 'MGM Low-End A',
    tagline: 'Bass-heavy vocal isolation',
    filename: 'MGM_LOWEND_A_v4.pth',
    description:
      'MGM low-end variant A. Handles bass-heavy genres where vocals sit close to kick and sub frequencies. Strong for hip-hop and trap.',
    stems: [2],
    tier: 'A',
    accent: '#d97706',
    glow: 'rgba(217,119,6,0.35)',
    glyph: '◒',
    tags: ['mgm', 'lowend', 'bass'],
    recommendedFor: ['hip-hop', 'trap', '808-heavy'],
    speed: 'balanced',
    quality: 85,
  },
  {
    id: 'vr_mgm_lowend_b',
    engine: 'vr',
    category: 'vocal',
    name: 'MGM Low-End B',
    tagline: 'Alt low-end vocal profile',
    filename: 'MGM_LOWEND_B_v4.pth',
    description:
      'Alternate low-end MGM profile with different sub-bass rejection characteristics. Try when Low-End A leaves too much low-frequency bleed.',
    stems: [2],
    tier: 'B',
    accent: '#b45309',
    glow: 'rgba(180,83,9,0.35)',
    glyph: '◓',
    tags: ['mgm', 'lowend'],
    recommendedFor: ['bass music', 'dubstep'],
    speed: 'balanced',
    quality: 83,
  },
  {
    id: 'vr_deecho_normal',
    engine: 'vr',
    category: 'restoration',
    name: 'De-Echo Normal',
    tagline: 'Room echo reduction',
    filename: 'UVR-De-Echo-Normal.pth',
    description:
      'Normal-strength de-echo model. Removes room reflections and slap-back delay from vocals while preserving natural tone and intimacy.',
    stems: [2],
    tier: 'specialty',
    accent: '#5eead4',
    glow: 'rgba(94,234,212,0.35)',
    glyph: '⌇',
    tags: ['echo', 'restoration'],
    recommendedFor: ['roomy recordings', 'home studio'],
    speed: 'balanced',
    quality: 82,
  },
  {
    id: 'vr_deecho_aggressive',
    engine: 'vr',
    category: 'restoration',
    name: 'De-Echo Aggressive',
    tagline: 'Heavy echo & slap removal',
    filename: 'UVR-De-Echo-Aggressive.pth',
    description:
      'Aggressive de-echo for heavily reverberant spaces. Strips long tails and hall reflections. Use when Normal mode leaves audible room sound.',
    stems: [2],
    tier: 'specialty',
    accent: '#2dd4bf',
    glow: 'rgba(45,212,191,0.35)',
    glyph: '⌗',
    tags: ['echo', 'aggressive'],
    recommendedFor: ['hall recordings', 'cathedral', 'garage'],
    speed: 'balanced',
    quality: 80,
  },
  {
    id: 'vr_dereverb',
    engine: 'vr',
    category: 'restoration',
    name: 'DeEcho + DeReverb',
    tagline: 'Combined echo & reverb strip',
    filename: 'UVR-DeEcho-DeReverb.pth',
    description:
      'Dual-purpose restoration model removing both echo and reverb tails. Best for cleaning podcast rooms, interview audio, and over-processed vocal chains.',
    stems: [2],
    tier: 'specialty',
    accent: '#67e8f9',
    glow: 'rgba(103,232,249,0.35)',
    glyph: '≋',
    tags: ['reverb', 'echo', 'podcast'],
    recommendedFor: ['podcasts', 'interviews', 'voiceover'],
    speed: 'slow',
    quality: 81,
  },
  {
    id: 'vr_denoise',
    engine: 'vr',
    category: 'restoration',
    name: 'DeNoise Full',
    tagline: 'Broadband noise reduction',
    filename: 'UVR-DeNoise.pth',
    description:
      'Full UVR denoise model for broadband hiss, fan noise, and tape hiss. Cleans noisy vocal recordings without the surgical targeting of DeNoise-Lite.',
    stems: [2],
    tier: 'specialty',
    accent: '#86efac',
    glow: 'rgba(134,239,172,0.35)',
    glyph: '⊘',
    tags: ['denoise', 'hiss'],
    recommendedFor: ['noisy recordings', 'archival', 'cassette'],
    speed: 'balanced',
    quality: 79,
  },
  {
    id: 'vr_denoise_lite',
    engine: 'vr',
    category: 'restoration',
    name: 'DeNoise Lite',
    tagline: 'Light vocal noise cleanup',
    filename: 'UVR-DeNoise-Lite.pth',
    description:
      'Lightweight denoiser used in Liminal\'s post-split vocal cleanup chain. Subtle broadband noise reduction that preserves vocal transients and presence.',
    stems: [2],
    tier: 'B',
    accent: '#4ade80',
    glow: 'rgba(74,222,128,0.3)',
    glyph: '○',
    tags: ['denoise', 'lite', 'post'],
    recommendedFor: ['post-split cleanup', 'subtle noise'],
    speed: 'fast',
    quality: 75,
  },
  {
    id: 'vr_bve_4b',
    engine: 'vr',
    category: 'vocal',
    name: 'BVE 4B',
    tagline: 'Broad vocal extractor 4-band',
    filename: 'UVR-BVE-4B_SN-44100-1.pth',
    description:
      '4-band broad vocal extractor at 44.1 kHz. Classic UVR architecture with reliable vocal/instrumental splits across a wide range of source material.',
    stems: [2],
    tier: 'B',
    accent: '#f97316',
    glow: 'rgba(249,115,22,0.35)',
    glyph: '□',
    tags: ['4band', 'classic'],
    recommendedFor: ['general purpose', 'legacy workflows'],
    speed: 'balanced',
    quality: 82,
  },

  // ── Spleeter & Drumsep ──────────────────────────────────
  {
    id: 'spleeter_2',
    engine: 'spleeter',
    category: 'fast',
    name: 'Spleeter 2-Stem',
    tagline: 'Free-tier vocal split',
    description:
      'Deezer Spleeter 2-stem (vocals + accompaniment). Fast and lightweight — included in the free trial tier. Lower fidelity than MDX or Roformer.',
    stems: [2],
    tier: 'B',
    accent: '#94a3b8',
    glow: 'rgba(148,163,184,0.3)',
    glyph: '▷',
    tags: ['free', 'fast'],
    recommendedFor: ['quick previews', 'free tier'],
    speed: 'fast',
    quality: 65,
  },
  {
    id: 'drumsep_49469',
    engine: 'drumsep',
    category: 'drums',
    name: 'Drumsep 49469',
    tagline: 'Kick · snare · tom · cymbal',
    description:
      'Specialized drum decomposition into kick, snare, toms, and cymbals. Run on an isolated drum stem or full mix for percussion sampling and sound design.',
    stems: [4],
    tier: 'specialty',
    accent: '#fbbf24',
    glow: 'rgba(251,191,36,0.4)',
    glyph: '⊕',
    tags: ['drums', 'percussion'],
    recommendedFor: ['drum sampling', 'breakdown', 'sound design'],
    speed: 'balanced',
    quality: 78,
  },
];

export const SEPARATION_MODELS_ALL: SeparationModel[] = [
  ...SEPARATION_MODELS,
  ...EXTENDED_MODELS,
];

// Re-export merged list as primary catalog
export { SEPARATION_MODELS_ALL as SEPARATION_MODELS_MERGED };

export const DEFAULT_MODEL_BY_ENGINE: Record<SeparationEngine, string> = {
  demucs: 'demucs_htdemucs',
  mdx: 'mdx23_ensemble',
  roformer: 'roformer_melband',
  vr: 'vr_hp_vocal_4',
  spleeter: 'spleeter_2',
  drumsep: 'drumsep_mdx23c_6',
  ensemble: 'mdx23_ensemble',
  karaoke: 'karaoke_mvsep_team',
  postfx: 'postfx_apollo_vocal',
  instrument: 'inst_guitar_sw',
};

export function getModelsForEngine(engine: SeparationEngine): SeparationModel[] {
  return SEPARATION_MODELS_ALL.filter((m) => m.engine === engine);
}

export function getModelById(id: string): SeparationModel | undefined {
  return SEPARATION_MODELS_ALL.find((m) => m.id === id);
}

export function supportsStems(model: SeparationModel, stemCount: number): boolean {
  return model.stems.includes(stemCount);
}

/** Expected output stem labels for instrument engine variants. */
export function getInstrumentStemLabels(modelId: string): string[] {
  if (modelId === 'inst_bs_roformer_sw') {
    return ['vocals', 'bass', 'drums', 'guitar', 'piano', 'other'];
  }
  if (modelId === 'inst_choir' || modelId === 'inst_choir_mf' || modelId === 'inst_choir_aufr33') {
    return ['male', 'female'];
  }
  if (modelId === 'inst_woodwinds') {
    return ['woodwinds', 'other'];
  }
  const model = getModelById(modelId);
  const tag = model?.tags.find((t) => t !== 'instrument' && t !== 'demucs') ?? 'instrument';
  return [tag, 'other'];
}

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  ensemble: 'Ensemble',
  vocal: 'Vocal',
  instrumental: 'Instrumental',
  karaoke: 'Karaoke',
  restoration: 'Restoration',
  multistem: 'Multistem',
  drums: 'Drums',
  fast: 'Fast',
  specialty: 'Specialty',
};