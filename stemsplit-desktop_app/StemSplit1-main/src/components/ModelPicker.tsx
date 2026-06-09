'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CATEGORY_LABELS,
  DEFAULT_MODEL_BY_ENGINE,
  ENGINE_META,
  SeparationEngine,
  SeparationModel,
  getModelById,
  getModelsForEngine,
  supportsStems,
} from '@/lib/model-catalog';

// ── Mini canvas particle burst on card hover ──────────────────────────────
const CardParticles: React.FC<{ color: string; active: boolean }> = ({ color, active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    type P = { x: number; y: number; vx: number; vy: number; life: number; size: number };
    const particles: P[] = [];

    const spawn = () => {
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
        const speed = 0.4 + Math.random() * 1.2;
        particles.push({
          x: w / 2,
          y: h / 2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          size: 1 + Math.random() * 2,
        });
      }
    };

    if (active) spawn();

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.018;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', `,${p.life * 0.7})`).replace('rgb', 'rgba');
        if (!color.startsWith('rgba') && !color.startsWith('rgb')) {
          ctx.globalAlpha = p.life * 0.8;
          ctx.fillStyle = color;
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (active && particles.length < 4) spawn();
      rafRef.current = requestAnimationFrame(tick);
    };

    if (active) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, w, h);
      particles.length = 0;
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [active, color]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={80}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-60 mix-blend-screen"
    />
  );
};

// ── Typewriter description reveal ───────────────────────────────────────
const TypewriterText: React.FC<{ text: string; keyId: string }> = ({ text, keyId }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 12);
    return () => clearInterval(interval);
  }, [text, keyId]);
  return (
    <span>
      {displayed}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ repeat: Infinity, duration: 0.6 }}
        className="inline-block w-[2px] h-[1em] bg-cyan-400 ml-0.5 align-middle"
      />
    </span>
  );
};

// ── Quality meter bar ───────────────────────────────────────────────────
const QualityMeter: React.FC<{ value: number; accent: string }> = ({ value, accent }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${accent}88, ${accent})` }}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
    <span className="text-[9px] font-mono text-slate-500 tabular-nums w-6">{value}</span>
  </div>
);

// ── Single model card ───────────────────────────────────────────────────
const ModelCard: React.FC<{
  model: SeparationModel;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = ({ model, selected, disabled, onSelect, onHover }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: disabled ? 0.35 : 1, y: 0, scale: selected ? 1.02 : 1 }}
      whileHover={disabled ? {} : { y: -3 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={() => !disabled && onSelect()}
      onMouseEnter={() => { setHovered(true); onHover(); }}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      className={`
        relative text-left w-full rounded-xl overflow-hidden
        border transition-colors duration-300
        ${selected
          ? 'border-transparent'
          : 'border-slate-800 hover:border-slate-600'}
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
      `}
      style={{
        boxShadow: selected ? `0 0 24px ${model.glow}, inset 0 0 0 1px ${model.accent}55` : undefined,
      }}
    >
      {/* Animated gradient mesh background */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: `
            radial-gradient(ellipse at 20% 50%, ${model.accent}44 0%, transparent 50%),
            radial-gradient(ellipse at 80% 20%, ${model.glow} 0%, transparent 40%),
            linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)
          `,
        }}
      />

      {/* Scan line sweep */}
      {(hovered || selected) && (
        <motion.div
          className="absolute inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
          initial={{ top: '0%' }}
          animate={{ top: '100%' }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
        />
      )}

      <CardParticles color={model.accent} active={hovered || selected} />

      {/* Tier badge */}
      <div
        className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
        style={{
          background: model.tier === 'S' ? `${model.accent}33` : '#1e293b',
          color: model.tier === 'S' ? model.accent : '#94a3b8',
          border: `1px solid ${model.tier === 'S' ? model.accent + '66' : '#334155'}`,
        }}
      >
        {model.tier === 'specialty' ? '★' : `${model.tier}-tier`}
      </div>

      <div className="relative z-10 p-2 space-y-1">
        <div className="flex items-start gap-1.5">
          <motion.span
            className="text-base leading-none mt-0.5"
            style={{ color: model.accent }}
            animate={selected ? { rotate: [0, 8, -8, 0], scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 0.5 }}
          >
            {model.glyph}
          </motion.span>
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-semibold text-slate-100 truncate"
              style={{ textShadow: selected ? `0 0 12px ${model.glow}` : undefined }}
            >
              {model.name}
            </p>
            <p className="text-[9px] text-slate-500 truncate">{model.tagline}</p>
          </div>
        </div>

        <QualityMeter value={model.quality} accent={model.accent} />

        <div className="flex flex-wrap gap-0.5">
          {model.stems.map((s) => (
            <span
              key={s}
              className="text-[8px] px-1.5 py-0.5 rounded-full font-mono"
              style={{ background: '#0f172a', color: model.accent, border: `1px solid ${model.accent}33` }}
            >
              {s}st
            </span>
          ))}
          <span className="text-[8px] px-1.5 py-0.5 rounded-full font-mono bg-slate-900 text-slate-500 border border-slate-700">
            {model.speed}
          </span>
        </div>
      </div>

      {/* Selection ring pulse */}
      {selected && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ border: `1px solid ${model.accent}` }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </motion.button>
  );
};

// ── Main picker ─────────────────────────────────────────────────────────
export interface ModelPickerProps {
  engine: SeparationEngine;
  selectedModelId: string;
  stemCount: number;
  disabled?: boolean;
  onEngineChange: (engine: SeparationEngine) => void;
  onModelChange: (modelId: string) => void;
  onPlaySound?: (name: string) => void;
}

const ModelPicker: React.FC<ModelPickerProps> = ({
  engine,
  selectedModelId,
  stemCount,
  disabled = false,
  onEngineChange,
  onModelChange,
  onPlaySound,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const engineModels = useMemo(() => getModelsForEngine(engine), [engine]);
  const selectedModel = useMemo(() => getModelById(selectedModelId), [selectedModelId]);

  const categories = useMemo(() => {
    const cats = new Set(engineModels.map((m) => m.category));
    return ['all', ...Array.from(cats)];
  }, [engineModels]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return engineModels.filter((m) => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.tagline.toLowerCase().includes(q) ||
        m.tags.some((t) => t.includes(q)) ||
        m.recommendedFor.some((r) => r.includes(q))
      );
    });
  }, [engineModels, categoryFilter, search]);

  const handleEngineTab = useCallback(
    (eng: SeparationEngine) => {
      onEngineChange(eng);
      onModelChange(DEFAULT_MODEL_BY_ENGINE[eng]);
      setCategoryFilter('all');
      setSearch('');
      onPlaySound?.('hover_tick');
    },
    [onEngineChange, onModelChange, onPlaySound]
  );

  const engines: SeparationEngine[] = [
    'ensemble', 'demucs', 'mdx', 'roformer', 'karaoke', 'vr', 'drumsep', 'instrument', 'postfx',
  ];

  return (
    <div className="space-y-2">
      {/* Engine tabs */}
      <div className="flex flex-wrap gap-1">
        {engines.map((eng) => {
          const meta = ENGINE_META[eng];
          const active = engine === eng;
          return (
            <motion.button
              key={eng}
              type="button"
              onClick={() => !disabled && handleEngineTab(eng)}
              disabled={disabled}
              whileHover={{ scale: disabled ? 1 : 1.04 }}
              whileTap={{ scale: disabled ? 1 : 0.96 }}
              className={`
                relative px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-wider
                transition-all duration-200 overflow-hidden
                ${active ? 'text-white' : 'text-slate-500 hover:text-slate-300'}
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
              style={{
                background: active ? `linear-gradient(135deg, ${meta.color}22, #0f172a)` : '#0f172a',
                border: `1px solid ${active ? meta.color + '66' : '#1e293b'}`,
                boxShadow: active ? `0 0 16px ${meta.glow}` : undefined,
              }}
            >
              {active && (
                <motion.div
                  layoutId="engine-tab-glow"
                  className="absolute inset-0 opacity-30"
                  style={{ background: `radial-gradient(circle at 50% 0%, ${meta.color}, transparent 70%)` }}
                />
              )}
              <span className="relative z-10">{meta.label}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Engine subtitle */}
      <motion.p
        key={engine}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-[9px] font-mono leading-tight"
        style={{ color: ENGINE_META[engine].color }}
      >
        {ENGINE_META[engine].subtitle}
      </motion.p>

      {/* Search + category filter */}
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models, tags, use cases…"
          disabled={disabled}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-cyan-600 outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-0.5 max-h-12 overflow-y-auto custom-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            disabled={disabled}
            className={`
              text-[9px] px-2 py-0.5 rounded-full font-mono transition-colors
              ${categoryFilter === cat
                ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50'
                : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'}
            `}
          >
            {cat === 'all' ? 'All' : CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
          </button>
        ))}
      </div>

      {/* Model grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
        <AnimatePresence mode="popLayout">
          {filteredModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selected={model.id === selectedModelId}
              disabled={disabled || !supportsStems(model, stemCount)}
              onSelect={() => {
                onModelChange(model.id);
                onPlaySound?.('click_engage');
              }}
              onHover={() => onPlaySound?.('hover_core')}
            />
          ))}
        </AnimatePresence>
        {filteredModels.length === 0 && (
          <p className="col-span-2 text-center text-[10px] text-slate-600 py-6 font-mono">
            No models match — try another stem count or category
          </p>
        )}
      </div>

      {/* Selected model detail panel */}
      <AnimatePresence mode="wait">
        {selectedModel && (
          <motion.div
            key={selectedModel.id}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
            transition={{ duration: 0.35 }}
            className="relative rounded-xl border overflow-hidden"
            style={{
              borderColor: selectedModel.accent + '44',
              background: `linear-gradient(160deg, ${selectedModel.accent}08 0%, #0f172a 60%)`,
              boxShadow: `0 4px 32px ${selectedModel.glow}`,
            }}
          >
            {/* Animated corner accents */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t border-l rounded-tl-xl" style={{ borderColor: selectedModel.accent + '66' }} />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r rounded-br-xl" style={{ borderColor: selectedModel.accent + '66' }} />

            <div className="p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <motion.span
                  className="text-lg"
                  style={{ color: selectedModel.accent }}
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 4, repeat: Infinity }}
                >
                  {selectedModel.glyph}
                </motion.span>
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-slate-100 truncate">{selectedModel.name}</h4>
                  <p className="text-[9px] font-mono truncate" style={{ color: selectedModel.accent }}>
                    {selectedModel.tagline}
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                {selectedModel.description}
              </p>

              <div className="flex flex-wrap gap-1">
                {selectedModel.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[8px] px-2 py-0.5 rounded font-mono uppercase tracking-wide"
                    style={{
                      background: selectedModel.accent + '15',
                      color: selectedModel.accent,
                      border: `1px solid ${selectedModel.accent}30`,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="text-[8px] text-slate-600 font-mono border-t border-slate-800 pt-1.5">
                <span className="text-slate-500">Best for: </span>
                {selectedModel.recommendedFor.join(' · ')}
                {selectedModel.filename && (
                  <span className="block mt-1 text-slate-700 truncate">weight: {selectedModel.filename}</span>
                )}
              </div>

              {!supportsStems(selectedModel, stemCount) && (
                <p className="text-[10px] text-amber-400 font-mono">
                  ⚠ Not compatible with {stemCount}-stem mode — switch stem count or pick another model
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ModelPicker;