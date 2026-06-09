'use client';
// src/components/TitleBar.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useLicense } from '@/contexts/LicenseContext';

// --- Quick Tools Menu Items ---
interface QuickToolItem {
    id: string;
    label: string;
    sublabel: string;
    icon: string;       // Unicode/emoji glyph
    accentColor: string; // Tailwind color for glow
    category: 'analysis' | 'post-fx' | 'utility';
    enabled: boolean;
}

const QUICK_TOOLS: QuickToolItem[] = [
    // -- Analysis --
    {
        id: 'madmom-bpm',
        label: 'Madmom BPM Detect',
        sublabel: 'Beat-track stems via madmom neural net',
        icon: '◉',
        accentColor: 'cyan',
        category: 'analysis',
        enabled: true,
    },
    {
        id: 'key-detect',
        label: 'Key & Scale Detection',
        sublabel: 'Identify musical key of each stem',
        icon: '♯',
        accentColor: 'purple',
        category: 'analysis',
        enabled: true,
    },
    {
        id: 'onset-detect',
        label: 'Onset / Transient Map',
        sublabel: 'Map transient positions for gating & alignment',
        icon: '⚡',
        accentColor: 'yellow',
        category: 'analysis',
        enabled: true,
    },
    // -- Auto Post-FX --
    {
        id: 'auto-fx-apply',
        label: 'Auto-FX Post Process',
        sublabel: 'Feed madmom analysis into auto effect chain',
        icon: '⟐',
        accentColor: 'emerald',
        category: 'post-fx',
        enabled: true,
    },
    {
        id: 'lufs-normalize',
        label: 'LUFS Loudness Match',
        sublabel: 'Normalize stems to target integrated loudness',
        icon: '▮',
        accentColor: 'blue',
        category: 'post-fx',
        enabled: true,
    },
    {
        id: 'phase-align',
        label: 'Phase Coherence Check',
        sublabel: 'Detect and correct inter-stem phase issues',
        icon: '∿',
        accentColor: 'rose',
        category: 'post-fx',
        enabled: true,
    },
    // -- Utilities --
    {
        id: 'stem-to-midi',
        label: 'Stem → MIDI Extract',
        sublabel: 'Convert melodic stems to MIDI via basic_pitch',
        icon: '♪',
        accentColor: 'amber',
        category: 'utility',
        enabled: true,
    },
    {
        id: 'quick-bounce',
        label: 'Quick Bounce Mix',
        sublabel: 'Recombine selected stems with balance controls',
        icon: '⊕',
        accentColor: 'teal',
        category: 'utility',
        enabled: true,
    },
];

const categoryLabels: Record<string, string> = {
    analysis: 'ANALYSIS',
    'post-fx': 'AUTO POST-FX',
    utility: 'UTILITIES',
};

const accentMap: Record<string, { text: string; border: string; glow: string; bg: string }> = {
    cyan:    { text: 'text-cyan-400',    border: 'border-cyan-500/30',    glow: 'shadow-cyan-500/40',    bg: 'bg-cyan-500' },
    purple:  { text: 'text-purple-400',  border: 'border-purple-500/30',  glow: 'shadow-purple-500/40',  bg: 'bg-purple-500' },
    yellow:  { text: 'text-yellow-400',  border: 'border-yellow-500/30',  glow: 'shadow-yellow-500/40',  bg: 'bg-yellow-500' },
    emerald: { text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/40', bg: 'bg-emerald-500' },
    blue:    { text: 'text-blue-400',    border: 'border-blue-500/30',    glow: 'shadow-blue-500/40',    bg: 'bg-blue-500' },
    rose:    { text: 'text-rose-400',    border: 'border-rose-500/30',    glow: 'shadow-rose-500/40',    bg: 'bg-rose-500' },
    amber:   { text: 'text-amber-400',   border: 'border-amber-500/30',   glow: 'shadow-amber-500/40',   bg: 'bg-amber-500' },
    teal:    { text: 'text-teal-400',    border: 'border-teal-500/30',    glow: 'shadow-teal-500/40',    bg: 'bg-teal-500' },
};

interface TitleBarProps {
    onToolTrigger?: (toolId: string) => void;
}

const TitleBar: React.FC<TitleBarProps> = ({ onToolTrigger }) => {
    const { isPro } = useLicense();
    const [isTauri, setIsTauri] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const iconRef = useRef<HTMLDivElement>(null);
    const [hoveredTool, setHoveredTool] = useState<QuickToolItem | null>(null);
    
    useEffect(() => {
        setIsTauri(typeof window !== 'undefined' && '__TAURI__' in window);
    }, []);

    // Close menu on outside click
    const handleClickOutside = useCallback((e: MouseEvent) => {
        if (
            menuRef.current && !menuRef.current.contains(e.target as Node) &&
            iconRef.current && !iconRef.current.contains(e.target as Node)
        ) {
            setMenuOpen(false);
        }
    }, []);

    useEffect(() => {
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen, handleClickOutside]);

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, []);

    const handleToolClick = async (tool: QuickToolItem) => {
        // Disabled: Currently these tools are for display/future preview only.
        console.log(`[QuickTools] Hovered/Info: ${tool.id}`);
    };

    // if (!isTauri) return null; // MOVED: Render title bar in all modes (VST included)

    // Group tools by category
    const grouped = QUICK_TOOLS.reduce<Record<string, QuickToolItem[]>>((acc, t) => {
        (acc[t.category] ??= []).push(t);
        return acc;
    }, {});

    return (
        <>
            <div 
                className="fixed top-0 left-0 right-0 h-10 z-[9999] flex justify-between items-center select-none bg-slate-950/90 backdrop-blur-md border-b border-cyan-900/30"
                data-tauri-drag-region
            >
                {/* Title / Icon Area - Left - Draggable */}
                <div 
                    className="flex items-center gap-2 pl-4 cursor-grab w-full h-full"
                    data-tauri-drag-region
                >
                    {/* Clickable Icon — opens Quick Tools */}
                    <div 
                        ref={iconRef}
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(prev => !prev); }}
                        className="relative w-6 h-6 flex items-center justify-center cursor-pointer group z-[101]"
                        title="Quick Tools"
                    >
                        {/* Outer pulse ring */}
                        <motion.div 
                            className="absolute inset-0 bg-cyan-500 rounded-full blur-md opacity-50 pointer-events-none"
                            animate={menuOpen 
                                ? { opacity: [0.6, 0.9, 0.6], scale: [1, 1.3, 1] } 
                                : { opacity: 0.4, scale: 1 }
                            }
                            transition={menuOpen 
                                ? { duration: 1.5, repeat: Infinity } 
                                : { duration: 0.3 }
                            }
                        />
                        {/* Icon image */}
                        <motion.img 
                            src="/app-icon.ico" 
                            alt="Quick Tools" 
                            className="w-full h-full object-contain relative z-10"
                            whileHover={{ scale: 1.15, filter: 'brightness(1.3)' }}
                            whileTap={{ scale: 0.9 }}
                            transition={{ duration: 0.1 }}
                        />
                        {/* Active indicator dot */}
                        <AnimatePresence>
                            {menuOpen && (
                                <motion.div
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0, opacity: 0 }}
                                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-cyan-400 rounded-full shadow-[0_0_6px_rgba(34,211,238,0.8)]"
                                />
                            )}
                        </AnimatePresence>
                    </div>
                    <span className="text-[9px] text-cyan-400/70 font-minimal font-light tracking-tight pointer-events-none uppercase">StemSplit v0.3.0</span>
                </div>

                {/* License Button Area */}
                <div className="flex items-center no-drag z-[101] mr-4 relative group">
                    {/* Glowing underlay */}
                    <div className={`absolute inset-0 blur-md rounded-full transition-all duration-300 ${isPro ? 'bg-emerald-500/20 group-hover:bg-emerald-500/40' : 'bg-amber-500/20 group-hover:bg-amber-500/40'}`} />
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('open-license-modal'));
                        }}
                        className={`relative px-4 py-1.5 rounded-sm bg-slate-900 border transition-all duration-300 text-[10px] font-mono font-bold uppercase tracking-[0.2em] cursor-pointer overflow-hidden flex items-center gap-2 ${
                            isPro 
                            ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500 hover:border-emerald-400 hover:text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.6)]' 
                            : 'border-amber-500/50 text-amber-400 hover:bg-amber-500 hover:border-amber-400 hover:text-slate-950 shadow-[0_0_10px_rgba(245,158,11,0.1)] hover:shadow-[0_0_20px_rgba(245,158,11,0.6)]'
                        }`}
                        title="Manage License & Upgrades"
                    >
                        {/* Scanline overlay inside button */}
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:100%_2px] pointer-events-none opacity-50 group-hover:opacity-20" />
                        <span className={`relative z-10 w-2 h-2 rounded-full shadow-[0_0_5px_currentColor] ${isPro ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
                        <span className="relative z-10">{isPro ? 'PRO ACTIVE' : 'UPGRADE TO PRO'}</span>
                    </button>
                </div>

                {/* Window Controls - Right - Non-Draggable (Only for Tauri App) */}
                {isTauri && (
                <div className="flex items-center gap-0 pr-0 h-full">
                    {/* Minimize Button */}
                    <div 
                        onClick={() => getCurrentWindow().minimize()}
                        className="w-10 h-10 flex items-center justify-center cursor-pointer hover:bg-cyan-900/20 transition-colors"
                    >
                        <motion.div 
                            className="w-3 h-[2px] bg-cyan-600 rounded-full"
                            whileHover={{ 
                                boxShadow: "0 0 8px 2px rgba(6,182,212,0.8), 0 0 15px 4px rgba(6,182,212,0.6)",
                                backgroundColor: "#22d3ee"
                            }}
                            transition={{ duration: 0.1 }}
                        />
                    </div>

                    {/* Close Button X */}
                    <div
                        onClick={() => getCurrentWindow().close()}
                        className="w-10 h-10 flex items-center justify-center cursor-pointer hover:bg-red-900/20 transition-colors"
                    >
                        <div className="relative w-4 h-4 flex items-center justify-center">
                             <motion.div 
                                className="absolute w-full h-[2px] bg-red-600 rounded-full rotate-45 origin-center"
                                whileHover={{ 
                                    boxShadow: "0 0 8px 2px rgba(248,113,113,0.8), 0 0 15px 4px rgba(248,113,113,0.6)",
                                    backgroundColor: "#f87171"
                                }} 
                               transition={{ duration: 0.1 }}
                            />
                            <motion.div 
                                className="absolute w-full h-[2px] bg-red-600 rounded-full -rotate-45 origin-center"
                                whileHover={{ 
                                    boxShadow: "0 0 8px 2px rgba(248,113,113,0.8), 0 0 15px 4px rgba(248,113,113,0.6)",
                                    backgroundColor: "#f87171"
                                }} 
                               transition={{ duration: 0.1 }}
                            />
                        </div>
                    </div>
                </div>
                )}
            </div>

            {/* === Quick Tools Dropdown === */}
            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, y: -8, scaleY: 0.92, scaleX: 0.97 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1, scaleX: 1 }}
                        exit={{ opacity: 0, y: -8, scaleY: 0.92, scaleX: 0.97 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        className="fixed top-10 left-3 z-[10000] w-72 origin-top-left shadow-2xl shadow-cyan-900/40"
                    >
                        {/* Glass container */}
                        <div className="relative rounded-lg overflow-hidden"
                             style={{
                                 background: 'linear-gradient(135deg, rgba(2,6,23,0.88) 0%, rgba(8,15,40,0.92) 50%, rgba(2,6,23,0.88) 100%)',
                                 backdropFilter: 'blur(24px) saturate(1.4)',
                                 WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                             }}
                        >
                            {/* Top accent line */}
                            <div className="h-[1px] w-full" style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.5) 30%, rgba(34,211,238,0.8) 50%, rgba(34,211,238,0.5) 70%, transparent 100%)',
                            }} />

                            {/* Scanline overlay */}
                            <div className="absolute inset-0 pointer-events-none opacity-[0.04] z-[1]"
                                 style={{
                                     backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.1) 2px, rgba(34,211,238,0.1) 4px)',
                                 }}
                            />

                            {/* Header */}
                            <div className="px-4 pt-3 pb-2 relative z-[2]">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                                    <span className="text-[10px] font-mono font-bold tracking-[0.3em] text-cyan-400/90 uppercase">Quick Tools</span>
                                </div>
                                <div className="mt-1 h-[1px] w-full bg-gradient-to-r from-cyan-500/20 via-slate-700/30 to-transparent" />
                            </div>

                            {/* Menu Items by Category */}
                            <div className="px-2 pb-3 relative z-[2] max-h-[420px] overflow-y-auto scrollbar-thin scrollbar-thumb-cyan-900/50 scrollbar-track-transparent">
                                {Object.entries(grouped).map(([cat, tools], catIdx) => (
                                    <div key={cat} className={catIdx > 0 ? 'mt-2' : ''}>
                                        {/* Category label */}
                                        <div className="px-2 py-1 flex items-center gap-2">
                                            <div className="h-[1px] flex-1 bg-slate-700/50" />
                                            <span className="text-[8px] font-mono tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
                                                {categoryLabels[cat] || cat}
                                            </span>
                                            <div className="h-[1px] flex-1 bg-slate-700/50" />
                                        </div>

                                        {/* Tool items */}
                                        {tools.map((tool) => {
                                            const accent = accentMap[tool.accentColor] || accentMap.cyan;
                                            return (
                                                <motion.button
                                                    key={tool.id}
                                                    onMouseEnter={() => setHoveredTool(tool)}
                                                    onMouseLeave={() => setHoveredTool(null)}
                                                    onClick={() => {
                                                        setMenuOpen(false);
                                                        onToolTrigger?.(tool.id);
                                                    }}
                                                    className={`
                                                        w-full text-left px-3 py-2 mx-0 rounded-md
                                                        flex items-start gap-3 group
                                                        transition-all duration-150 
                                                        hover:bg-white/[0.04]
                                                        cursor-pointer
                                                        relative overflow-hidden
                                                    `}
                                                    whileHover={{ x: 2 }}
                                                >
                                                    {/* Hover glow edge */}
                                                    <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${accent.bg} opacity-0 group-hover:opacity-60 transition-opacity duration-150 shadow-[0_0_8px] ${accent.glow}`} />

                                                    {/* Icon */}
                                                    <span className={`text-base ${accent.text} opacity-70 group-hover:opacity-100 transition-opacity mt-0.5 font-mono leading-none`}>
                                                        {tool.icon}
                                                    </span>

                                                    {/* Text */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[11px] font-mono text-slate-200 group-hover:text-white transition-colors leading-tight">
                                                            {tool.label}
                                                        </div>
                                                        <div className="text-[9px] font-minimal text-slate-500 group-hover:text-slate-400 transition-colors leading-snug mt-0.5 truncate">
                                                            {tool.sublabel}
                                                        </div>
                                                    </div>

                                                    {/* Chevron */}
                                                    <span className="text-[10px] text-slate-600 group-hover:text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-all duration-150 translate-x-1 group-hover:translate-x-0">
                                                        ›
                                                    </span>
                                                </motion.button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            {/* Bottom accent line */}
                            <div className="h-[1px] w-full" style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.3) 50%, transparent 100%)',
                            }} />

                            {/* Corner decorations */}
                            <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-cyan-500/20 rounded-tr-lg pointer-events-none" />
                            <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-cyan-500/20 rounded-bl-lg pointer-events-none" />
                        </div>

                        {/* HOVER TOOLTIP BUBBLE */}
                        <AnimatePresence>
                            {hoveredTool && (
                                <motion.div
                                    initial={{ opacity: 0, x: -10, scale: 0.95 }}
                                    animate={{ opacity: 1, x: 0, scale: 1 }}
                                    exit={{ opacity: 0, x: -10, scale: 0.95 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute left-full top-0 ml-4 w-64 z-[10001] pointer-events-none"
                                >
                                    <div className="relative rounded-lg overflow-hidden p-4 shadow-2xl shadow-cyan-900/50 border border-slate-700/50"
                                         style={{
                                             background: 'rgba(2,6,23,0.95)',
                                             backdropFilter: 'blur(24px)',
                                         }}
                                    >
                                        {/* Accent Border based on category */}
                                        <div className={`absolute top-0 left-0 bottom-0 w-[3px] ${accentMap[hoveredTool.accentColor]?.bg || 'bg-cyan-500'}`} />

                                        {/* Header */}
                                        <div className="flex items-start gap-3 mb-2">
                                            <span className={`text-xl ${accentMap[hoveredTool.accentColor]?.text || 'text-cyan-400'}`}>
                                                {hoveredTool.icon}
                                            </span>
                                            <div>
                                                <h4 className={`font-mono font-bold text-sm leading-tight ${accentMap[hoveredTool.accentColor]?.text || 'text-cyan-400'}`}>
                                                    {hoveredTool.label}
                                                </h4>
                                                <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block mt-0.5">
                                                    {categoryLabels[hoveredTool.category] || 'TOOL'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Description */}
                                        <p className="text-xs text-slate-300 font-minimal leading-relaxed mb-3">
                                            {hoveredTool.sublabel}
                                        </p>

                                        {/* Status Badge */}
                                        <div className="flex items-center gap-2 mt-auto pt-2 border-t border-slate-800/50">
                                            <div className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/50 flex items-center gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_#10b981]" />
                                                <span className="text-[9px] font-mono font-bold text-slate-300 uppercase tracking-wide">
                                                    Ready
                                                </span>
                                            </div>
                                            {hoveredTool.category === 'analysis' && (
                                                <span className="text-[9px] font-mono text-cyan-600/80 uppercase tracking-wider">
                                                    AI-Based
                                                </span>
                                            )}
                                        </div>
                                        
                                        {/* Scanlines / Texture */}
                                        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
                                            style={{ backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, .3) 25%, rgba(255, 255, 255, .3) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .3) 75%, rgba(255, 255, 255, .3) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, .3) 25%, rgba(255, 255, 255, .3) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .3) 75%, rgba(255, 255, 255, .3) 76%, transparent 77%, transparent)'}}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default TitleBar;
