'use client';

import React from 'react';
import { motion, Variants } from 'framer-motion';

const MODEL_CARDS = [
  {
    name: 'Studio Vocals',
    tagline: 'Isolate vocals with surgical precision',
    category: 'Vocals',
    color: '#22d3ee',
    borderClass: 'border-cyan-500/20 hover:border-cyan-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(34,211,238,0.2)] hover:shadow-[0_0_40px_rgba(34,211,238,0.4)]',
    tagClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  },
  {
    name: 'Instrumental',
    tagline: 'Extract clean backing tracks',
    category: 'Music',
    color: '#22c55e',
    borderClass: 'border-green-500/20 hover:border-green-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(34,197,94,0.2)] hover:shadow-[0_0_40px_rgba(34,197,94,0.4)]',
    tagClass: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  {
    name: 'Demucs 4-Stem',
    tagline: 'Vocals, drums, bass, and other',
    category: 'Multistem',
    color: '#a855f7',
    borderClass: 'border-purple-500/20 hover:border-purple-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:shadow-[0_0_40px_rgba(168,85,247,0.4)]',
    tagClass: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  {
    name: 'Drum Split',
    tagline: 'Separate kick, snare, toms, cymbals',
    category: 'Drums',
    color: '#3b82f6',
    borderClass: 'border-blue-500/20 hover:border-blue-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(59,130,246,0.2)] hover:shadow-[0_0_40px_rgba(59,130,246,0.4)]',
    tagClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  {
    name: 'Karaoke Maker',
    tagline: 'Remove lead vocal, keep backing',
    category: 'Karaoke',
    color: '#f97316',
    borderClass: 'border-orange-500/20 hover:border-orange-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(249,115,22,0.2)] hover:shadow-[0_0_40px_rgba(249,115,22,0.4)]',
    tagClass: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  },
  {
    name: 'Crowd Removal',
    tagline: 'Clean up live recordings',
    category: 'Restoration',
    color: '#ec4899',
    borderClass: 'border-pink-500/20 hover:border-pink-500/50',
    glowClass: 'shadow-[0_0_15px_rgba(236,72,153,0.2)] hover:shadow-[0_0_40px_rgba(236,72,153,0.4)]',
    tagClass: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  },
];

const WaveBar: React.FC<{ index: number; color: string }> = ({ index, color }) => (
  <motion.div
    className="w-[3px] rounded-full"
    style={{ backgroundColor: color }}
    animate={{
      height: [Math.random() * 30 + 8, Math.random() * 50 + 20, Math.random() * 30 + 8],
    }}
    transition={{
      duration: 1.2 + Math.random() * 0.6,
      repeat: Infinity,
      delay: index * 0.08,
      ease: 'easeInOut',
    }}
  />
);

const AnimatedWaveform: React.FC = () => {
  const bars = 32;
  return (
    <div className="flex items-end gap-[2px] h-16">
      {Array.from({ length: bars }).map((_, i) => (
        <WaveBar key={i} index={i} color={i < 8 ? '#22d3ee' : i < 16 ? '#a855f7' : i < 24 ? '#22d3ee' : '#a855f7'} />
      ))}
    </div>
  );
};

const LandingHero: React.FC = () => {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.15 },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  return (
    <motion.div
      className="relative z-10 w-full flex flex-col items-center"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Logo / brand mark */}
      <motion.div variants={itemVariants} className="mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.3)]">
          <span className="text-slate-950 font-black text-xl">L</span>
        </div>
      </motion.div>

      {/* Hero title */}
      <motion.h1
        variants={itemVariants}
        className="text-[clamp(2.5rem,7vw,5rem)] font-black tracking-tighter leading-none text-center"
      >
        <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent">
          AI Audio
        </span>
        <br />
        <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          Extraction Studio
        </span>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        variants={itemVariants}
        className="mt-6 text-lg text-slate-400 max-w-xl text-center leading-relaxed font-light"
      >
        Isolate vocals, instruments, drums, and more with state-of-the-art AI models.
        Professional-grade stem separation for musicians, producers, and content creators.
      </motion.p>

      {/* Animated waveform */}
      <motion.div variants={itemVariants} className="mt-10 opacity-40">
        <AnimatedWaveform />
      </motion.div>

      {/* CTA */}
      <motion.div variants={itemVariants} className="mt-10 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 px-6 py-3 rounded-full border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm">
          <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-cyan-300 font-mono text-sm">Drop your audio file below to begin</span>
        </div>
        <span className="text-slate-600 font-mono text-[10px] tracking-widest uppercase">
          Supports WAV · MP3 · FLAC · OGG · M4A
        </span>
      </motion.div>

      {/* Model showcase */}
      <motion.div variants={itemVariants} className="mt-20 w-full max-w-5xl px-4">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="h-[1px] w-12 bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
          <span className="text-[10px] font-mono tracking-[0.3em] text-cyan-500/50 uppercase">Models</span>
          <div className="h-[1px] w-12 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODEL_CARDS.map((model) => (
            <motion.div
              key={model.name}
              className={`group relative rounded-xl border bg-gradient-to-b from-white/[0.03] to-white/[0.01] backdrop-blur-sm p-5 transition-all duration-300 cursor-default ${model.borderClass} ${model.glowClass} hover:scale-[1.02] hover:bg-white/[0.02]`}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            >
              {/* Category tag */}
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono tracking-wider uppercase ${model.tagClass}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: model.color }} />
                {model.category}
              </div>

              {/* Model name */}
              <h3 className="mt-4 text-base font-semibold text-white group-hover:text-cyan-300 transition-colors">
                {model.name}
              </h3>

              {/* Tagline */}
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                {model.tagline}
              </p>

              {/* Bottom accent line */}
              <div
                className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: `linear-gradient(90deg, transparent, ${model.color}, transparent)`,
                  boxShadow: `0 0 10px ${model.color}`,
                }}
              />
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Feature highlights */}
      <motion.div variants={itemVariants} className="mt-20 w-full max-w-4xl px-4 pb-8">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="h-[1px] w-12 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
          <span className="text-[10px] font-mono tracking-[0.3em] text-purple-500/50 uppercase">Capabilities</span>
          <div className="h-[1px] w-12 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'GPU Accelerated', desc: 'CUDA-powered inference for lightning-fast separation on NVIDIA hardware.', icon: '⚡' },
            { title: 'Batch Processing', desc: 'Queue multiple files and process them in one go with automatic workflow.', icon: '📦' },
            { title: 'Transcription', desc: 'Transcribe vocals and speech with Whisper AI — lyrics, podcasts, interviews.', icon: '🎤' },
            { title: 'FX Processing', desc: 'Apply EQ, reverb, compression, and spatial effects to individual stems.', icon: '🎛️' },
            { title: 'Mastering Chain', desc: 'Auto-master your mixes through a professional pedalboard processing chain.', icon: '🎚️' },
            { title: 'YouTube Import', desc: 'Download audio directly from YouTube links for instant separation.', icon: '📥' },
          ].map((feat) => (
            <div
              key={feat.title}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300"
            >
              <span className="text-lg">{feat.icon}</span>
              <h4 className="mt-3 text-sm font-semibold text-white">{feat.title}</h4>
              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default LandingHero;
