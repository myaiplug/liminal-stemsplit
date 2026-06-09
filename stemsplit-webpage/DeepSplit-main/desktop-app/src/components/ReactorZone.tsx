'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { useStemSplit, StemSplitStatus } from '@/hooks/useStemSplit';
import { downloadYouTubeAudio, openResultsFolder, transcribeAudio, WhisperTranscriptionResult } from '@/lib/tauri-bridge';
import { useLicense } from '@/contexts/LicenseContext';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import TitleBar from './TitleBar';
import StemPlayer from './StemPlayer';
import OriginalPlayer from './OriginalPlayer';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import { Howl } from 'howler';

// --- Sound System ---

const sounds: Record<string, Howl> = {};

const useSoundSystem = () => {
    useEffect(() => {
        const sfx = [
            'hover_tick', 'hover_core', 'click_engage', 'process_start',
            'success_chime', 'error_buzz', 'stem_active'
        ];
        sfx.forEach(s => {
            if (!sounds[s]) {
                sounds[s] = new Howl({ 
                    src: [`/sounds/${s}.wav`], 
                    volume: 0.6,
                    loop: false,
                    preload: true
                });
            }
        });
    }, []);

    const play = useCallback((name: string) => {
        if (sounds[name]) {
            sounds[name].stop();
            sounds[name].play();
        }
    }, []);
    
    const stop = useCallback((name: string) => {
        if (sounds[name]) sounds[name].stop();
    }, []);

    return { play, stop };
};

// --- WebGL Visualizer Details ---

/**
 * Single particle layer — used twice (main + RGB-glitch offset)
 */
const ParticleLayer: React.FC<{
    positions: Float32Array;
    maxParticles: number;
    drawCount: number;
    color: string;
    opacity: number;
    size: number;
    rotationRef: React.MutableRefObject<THREE.Euler>;
    scaleRef: React.MutableRefObject<THREE.Vector3>;
    offset?: [number, number, number];
}> = ({ positions, maxParticles, drawCount, color, opacity, size, rotationRef, scaleRef, offset }) => {
    const ref = useRef<THREE.Points>(null!);

    useFrame(() => {
        if (!ref.current) return;
        ref.current.geometry.setDrawRange(0, drawCount);
        ref.current.rotation.copy(rotationRef.current);
        ref.current.scale.copy(scaleRef.current);
        if (offset) {
            ref.current.position.set(offset[0], offset[1], offset[2]);
        }
    });

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={maxParticles}
                    array={positions}
                    itemSize={3}
                />
            </bufferGeometry>
            <pointsMaterial
                attach="material"
                size={size}
                color={color}
                transparent
                opacity={opacity}
                sizeAttenuation
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
};

const ParticleSphere: React.FC<{ isProcessing: boolean; progress: number; bassEnergy: number }> = ({ isProcessing, progress, bassEnergy }) => {
    const MAX_PARTICLES = 800;

    const positions = useMemo(() => {
        const p = new Float32Array(MAX_PARTICLES * 3);
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const r = 0.4 + Math.random() * 0.12;
            const theta = THREE.MathUtils.randFloatSpread(360);
            const phi = THREE.MathUtils.randFloatSpread(360);
            p[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
            p[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
            p[i * 3 + 2] = r * Math.cos(theta);
        }
        return p;
    }, []);

    // Shared rotation / scale driven by the controller frame loop
    const sharedRotation = useRef(new THREE.Euler(0, 0, 0));
    const sharedScale = useRef(new THREE.Vector3(1, 1, 1));

    // Ramp-up: particles and speed build from near-zero to full over ~8 s
    const lifecycle = useRef(0);       // 0-1 ramp
    const smoothBass = useRef(0);
    const currentSpeed = useRef(0);    // smoothed speed multiplier
    const currentCount = useRef(20);   // smoothed visible particle count
    const targetRotation = useRef({ x: 0, y: 0 });
    const glitchOffset = useRef<[number, number, number]>([0, 0, 0]);

    useFrame((state, delta) => {
        // --- lifecycle ramp (0 → 1 over ~8 seconds) ---
        if (lifecycle.current < 1) {
            lifecycle.current = Math.min(1, lifecycle.current + delta / 8);
        }
        const life = lifecycle.current;
        const eased = 1 - Math.pow(1 - life, 3); // ease-out cubic

        // --- bass smoothing ---
        smoothBass.current += (bassEnergy - smoothBass.current) * 0.25;
        const bass = smoothBass.current;
        const hasBass = bass > 0.01;

        // --- particle count: starts very low, builds up ---
        let targetCount: number;
        if (isProcessing) {
            const min = 20;
            targetCount = min + (progress / 100) * (MAX_PARTICLES * eased - min);
        } else {
            // idle / playing: ramp from ~15 to MAX over lifecycle
            targetCount = 15 + eased * (MAX_PARTICLES - 15);
        }
        currentCount.current += (targetCount - currentCount.current) * 0.04;

        // --- speed: gentle drift, much slower than before ---
        let targetSpeed: number;
        if (isProcessing) {
            targetSpeed = 0.08 + eased * 0.1;
        } else if (hasBass) {
            targetSpeed = 0.02 + bass * 0.15;
        } else {
            targetSpeed = 0.005 * eased;
        }
        currentSpeed.current += (targetSpeed - currentSpeed.current) * 0.04;
        const spd = currentSpeed.current;

        // --- rotation: very gentle drift ---
        const rot = sharedRotation.current;
        if (isProcessing) {
            const time = state.clock.getElapsedTime();
            const beat = Math.sin(time * 6);
            const pulseScale = Math.max(0, beat) * 0.04;
            const s = 1.0 + pulseScale;
            sharedScale.current.lerp(new THREE.Vector3(s, s, s), 0.08);
            rot.x += delta * spd * 0.15;
        } else if (hasBass) {
            const pulseScale = bass * 0.12;
            const s = 1.0 + pulseScale;
            sharedScale.current.lerp(new THREE.Vector3(s, s, s), 0.08);
            targetRotation.current.x = state.pointer.y * 0.15;
            targetRotation.current.y = state.pointer.x * 0.15;
            rot.x += (targetRotation.current.x - rot.x) * 0.015;
            rot.y += (targetRotation.current.y - rot.y) * 0.015;
        } else {
            sharedScale.current.lerp(new THREE.Vector3(1, 1, 1), 0.04);
            targetRotation.current.x = state.pointer.y * 0.15;
            targetRotation.current.y = state.pointer.x * 0.15;
            rot.x += (targetRotation.current.x - rot.x) * 0.015;
            rot.y += (targetRotation.current.y - rot.y) * 0.015;
        }
        rot.y += delta * spd * 0.5;
        rot.z += delta * spd * 0.15;

        // --- RGB glitch offset: very subtle jitter ---
        const jitterAmp = isProcessing ? 0.012 + eased * 0.008 : hasBass ? 0.006 + bass * 0.015 : 0.004;
        const time = state.clock.getElapsedTime();
        glitchOffset.current = [
            Math.sin(time * 3.7) * jitterAmp,
            Math.cos(time * 2.9) * jitterAmp * 0.6,
            Math.sin(time * 4.3) * jitterAmp * 0.4,
        ];
    });

    // --- colours ---
    const hasBassActive = bassEnergy > 0.01;
    const mainColor = isProcessing ? '#22d3ee' : hasBassActive ? '#67e8f9' : '#64748b';
    const mainOpacity = isProcessing ? 0.85 : hasBassActive ? 0.65 + bassEnergy * 0.3 : 0.5;
    // Glitch layers: red-shifted + blue-shifted, lower opacity
    const glitchOpacity = isProcessing ? 0.3 : hasBassActive ? 0.15 + bassEnergy * 0.2 : 0.12;
    const particleSize = 0.012;
    const drawCount = Math.floor(currentCount.current);

    return (
        <group>
            {/* Main cyan/slate layer */}
            <ParticleLayer
                positions={positions}
                maxParticles={MAX_PARTICLES}
                drawCount={drawCount}
                color={mainColor}
                opacity={mainOpacity}
                size={particleSize}
                rotationRef={sharedRotation}
                scaleRef={sharedScale}
            />
            {/* Red-shifted glitch duplicate */}
            <ParticleLayer
                positions={positions}
                maxParticles={MAX_PARTICLES}
                drawCount={drawCount}
                color="#ff3355"
                opacity={glitchOpacity}
                size={particleSize * 0.9}
                rotationRef={sharedRotation}
                scaleRef={sharedScale}
                offset={glitchOffset.current}
            />
            {/* Blue-shifted glitch duplicate (opposite offset) */}
            <ParticleLayer
                positions={positions}
                maxParticles={MAX_PARTICLES}
                drawCount={drawCount}
                color="#3366ff"
                opacity={glitchOpacity * 0.8}
                size={particleSize * 0.9}
                rotationRef={sharedRotation}
                scaleRef={sharedScale}
                offset={glitchOffset.current.map(v => -v) as [number, number, number]}
            />
        </group>
    );
};

// --- Types ---

type StemType = 'vocals' | 'drums' | 'bass' | 'other' | 'piano' | 'guitar' | 'kick' | 'snare' | 'toms' | 'cymbals' | 'instrumental';

// --- Visual Components ---

/**
 * Background Particle System
 * Creates a floating dust/star field effect for depth
 */
const ParticleSystem: React.FC = () => {
    // Generate static random positions to avoid hydration mismatch
    const particles = useMemo(() => Array.from({ length: 50 }).map(() => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 1,
        duration: Math.random() * 20 + 10,
        delay: Math.random() * 5
    })), []);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {particles.map((p, i) => (
                <motion.div
                    key={i}
                    className="absolute rounded-full bg-cyan-500/20"
                    style={
                        {
                            '--particle-left': `${p.x}%`,
                            '--particle-top': `${p.y}%`,
                            '--particle-size': `${p.size}px`,
                            left: 'var(--particle-left)',
                            top: 'var(--particle-top)',
                            width: 'var(--particle-size)',
                            height: 'var(--particle-size)',
                        } as React.CSSProperties
                    }
                    animate={{
                        y: [0, -100],
                        opacity: [0, 1, 0],
                    }}
                    transition={{
                        duration: p.duration,
                        repeat: Infinity,
                        delay: p.delay,
                        ease: "linear",
                    }}
                />
            ))}
        </div>
    );
};

// --- Move handleOpenDialog and related logic to the main component scope below ---
/**
 * Glitch Text Effect
 * Renders text with a cyberpunk decoding animation
 */
const GlitchText: React.FC<{ text?: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode }> = ({ text, className, style, children }) => {
    const content = children || text;
    return (
        <div className={`relative group ${className}`} style={style}>
            <span className="relative z-10">{content}</span>
            {text && <span className="absolute top-0 left-[1px] -z-10 opacity-50 text-red-500 animate-glitch-1">{text}</span>}
            {text && <span className="absolute top-0 -left-[1px] -z-10 opacity-50 text-cyan-500 animate-glitch-2">{text}</span>}
        </div>
    );
};

/**
 * Status LED component for individual stem indicators
 * Enhanced with physical glow and label connection lines
 */
const StatusLED: React.FC<{
  label: string;
  isActive: boolean;
  score?: number;
}> = ({ label, isActive, score }) => {
  const stemColors: Record<string, string> = {
    vocals: 'from-purple-500 to-pink-500',
    drums: 'from-red-500 to-orange-500',
    bass: 'from-blue-500 to-cyan-500',
    other: 'from-yellow-500 to-green-500',
    piano: 'from-fuchsia-500 to-purple-600',
    guitar: 'from-orange-400 to-amber-500',
    kick: 'from-red-600 to-rose-700',
    snare: 'from-yellow-400 to-amber-500', 
    toms: 'from-blue-400 to-indigo-500',
    cymbals: 'from-cyan-300 to-sky-400',
    instrumental: 'from-green-400 to-emerald-500'
  };

  const colorClass = stemColors[label] || 'from-slate-500 to-slate-400';
  const glowColor = isActive ? colorClass.split(' ')[1].replace('to-', '') : 'gray-800';

  return (
    <motion.div
      className="flex flex-col items-center gap-3 relative group"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
        {/* Connector Line to Core (Visual flourish) */}
       <div className={`absolute -top-12 w-px h-12 bg-gradient-to-t from-${glowColor}/50 to-transparent transition-all duration-500 ${isActive ? 'opacity-100' : 'opacity-10'}`} />

      {/* LED Housing */}
      <div className="relative">
          <motion.div
            className={`w-4 h-4 rounded-full border border-slate-700 bg-slate-900 overflow-hidden relative z-10 transition-all duration-500 ${isActive ? 'border-cyan-500/50' : ''}`}
          >
             {/* The Diode */}
            <motion.div
                className={`absolute inset-0 w-full h-full opacity-80 ${isActive ? `bg-gradient-to-br ${colorClass}` : 'bg-slate-800'}`}
                animate={isActive ? { opacity: [0.8, 1, 0.8] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
            />
          </motion.div>
          {/* External Glow / Bloom */}
          <motion.div
            className={`absolute inset-0 rounded-full blur-md ${isActive ? `bg-gradient-to-br ${colorClass}` : ''}`}
            animate={isActive ? { opacity: [0.4, 0.8, 0.4], scale: [1, 1.5, 1] } : { opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity }}
          />
      </div>

      {/* Label Box */}
      <div className="text-center">
        <span className={`text-[10px] font-mono uppercase tracking-[0.2em] transition-colors duration-300 ${isActive ? 'text-cyan-400 text-shadow-glow' : 'text-slate-600'}`}>
            {label}
        </span>
        
        {/* Purity Score - Marketing Gold */}
        <AnimatePresence>
            {score !== undefined && (
                <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-1"
                >
                    <div className="text-[9px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                        {score}% PURE
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </motion.div>
    );
};

/**
 * Enhanced Frequency Visualizer
 * Uses multi-layered bars for a 3D effect
 */
const FrequencyWaveform: React.FC<{ isProcessing: boolean }> = ({ isProcessing }) => {
    // Generate data for 3 layers of waves
    const generateWave = (count: number) => Array.from({ length: count }, () => Math.random() * 40 + 5);
    const [layer1, setLayer1] = useState(generateWave(30)); 
    const [layer2, setLayer2] = useState(generateWave(20));

    useEffect(() => {
        if (!isProcessing) return;
        const interval = setInterval(() => {
            setLayer1(prev => prev.map(() => Math.random() * 40 + 10));
            setLayer2(prev => prev.map(() => Math.random() * 30 + 5));
        }, 80);
        return () => clearInterval(interval);
    }, [isProcessing]);

    if (!isProcessing) return null;

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Back Layer (Darker, Slower) */}
            <div className="flex items-end justify-center gap-1 h-32 opacity-30 scale-90 blur-[1px]">
                 {layer2.map((h, i) => (
                    <motion.div 
                        key={`b-${i}`} 
                        className="w-2 bg-cyan-900 rounded-t-sm"
                        animate={{ height: h }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    />
                ))}
            </div>

             {/* Front Layer (Bright, Fast) */}
             <div className="flex items-end justify-center gap-1 h-32 absolute z-10">
                 {layer1.map((h, i) => (
                    <motion.div 
                        key={`f-${i}`} 
                        className="w-1.5 bg-gradient-to-t from-cyan-600 to-cyan-300 rounded-t-full shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                        animate={{ height: h, opacity: [0.8, 1] }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    />
                ))}
            </div>
        </div>
    );
};

/**
 * WebGL Visualization Wrapper
 */
const CoreVisualizer: React.FC<{ isProcessing: boolean; progress: number; bassEnergy: number }> = ({ isProcessing, progress, bassEnergy }) => {
    return (
        <div className="absolute inset-0 pointer-events-none">
            <Canvas camera={{ position: [0, 0, 2.2], fov: 45 }} gl={{ alpha: true }} className="w-full h-full">
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} />
                <ParticleSphere isProcessing={isProcessing} progress={progress} bassEnergy={bassEnergy} />
            </Canvas>
        </div>
    );
};

/**
 * HoloGrid Component
 * Renders a holographic grid background effect
 */
const HoloGrid: React.FC = () => {
    return (
        <div className="absolute inset-0 pointer-events-none">
            <svg width="100%" height="100%" className="opacity-10">
                <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(34, 211, 238, 0.3)" strokeWidth="1" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
        </div>
    );
};

/**
 * ReactorCoreRing Component
 * The central complex visual element
 */
const ReactorCoreRing: React.FC<{
  isExpanded: boolean;
  isDragOver: boolean;
  progress: number;
  status: StemSplitStatus;
}> = ({ isExpanded, isDragOver, progress, status }) => {
  const circumference = 2 * Math.PI * 140; 
  const isComplete = status === StemSplitStatus.COMPLETED;
  const isError = status === StemSplitStatus.ERROR;

  // Colors based on state
  const mainColor = isError ? '#ef4444' : isComplete ? '#10b981' : '#22d3ee'; // Red, Green, Cyan

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
       <motion.svg
         width="400" height="400" viewBox="0 0 400 400"
         animate={{ scale: isExpanded ? 1.05 : 1 }}
         transition={{ duration: 0.4 }}
       >
          <defs>
            <filter id="core-glow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
            <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                 <stop offset="0%" stopColor={mainColor} stopOpacity="1" />
                 <stop offset="100%" stopColor={isError ? '#7f1d1d' : '#0ea5e9'} stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* 1. Static Base Ring */}
          <circle cx="200" cy="200" r="140" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          
          {/* 2. Outer Rotating Tech Ring (Opposite spin) */}
          <motion.circle 
             cx="200" cy="200" r="150" fill="none" 
             stroke={mainColor} strokeOpacity="0.2" strokeWidth="1" strokeDasharray="10 20 40 20"
             animate={{ rotate: -360 }}
             transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
             className="origin-center"
          />

          {/* 3. Inner Rotating Tech Ring (Forward spin) */}
          <motion.circle 
             cx="200" cy="200" r="130" fill="none" 
             stroke={mainColor} strokeOpacity="0.3" strokeWidth="2" strokeDasharray="2 10 2 20"
             animate={{ rotate: 360 }}
             transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
             className="origin-center"
          />

          {/* 4. Active Progress Arc */}
          <motion.circle
             cx="200" cy="200" r="140" fill="none"
             stroke="url(#ring-grad)" strokeWidth="6" strokeLinecap="round"
             strokeDasharray={`${(progress / 100) * circumference} ${circumference}`}
             transform="rotate(-90 200 200)"
             filter="url(#core-glow)"
          />
       </motion.svg>
       
       {/* 5. Center Glow Bloom */}
       <motion.div 
            className={`absolute w-32 h-32 rounded-full blur-[60px] opacity-20 transition-colors duration-500 core-glow-bloom`}
            animate={{ backgroundColor: mainColor }}
            transition={{ duration: 0.5 }}
       />
    </div>
  );
};


// --- Glitch Wrapper ---

const GlitchWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 1. We create independent control hooks to run potentially overlapping animation sequences
    const controls = useAnimation();
    const flashControls = useAnimation();
    
    // 2. Main Glitch Loop
    useEffect(() => {
        let isMounted = true;
        const triggerGlitch = async () => {
            if (!isMounted) return;
            // Short random break (3-12 sec)
            const breakTime = Math.random() * 9000 + 3000;
            // Wait
            await new Promise(r => setTimeout(r, breakTime));
            
            if (!isMounted) return;
            
            // Execute Random Type Glitch
            const type = Math.random();
            
            if (type > 0.6) {
                // Skew Snap
                await controls.start({
                    skewX: [0, 5, -5, 0],
                    x: [0, -3, 3, 0],
                    transition: { duration: 0.15, ease: "easeInOut" }
                });
            } else if (type > 0.3) {
                 // Color Flash Shift
                 flashControls.start({
                     opacity: [0, 0.4, 0],
                     backgroundColor: ["rgba(34, 211, 238, 0)", "rgba(239, 68, 68, 0.4)", "rgba(34, 211, 238, 0)"],
                     transition: { duration: 0.1 }
                 });
                 await controls.start({
                     scale: [1, 1.05, 1],
                     filter: ["brightness(1) contrast(1)", "brightness(1.5) contrast(1.2)", "brightness(1) contrast(1)"],
                     transition: { duration: 0.1 }
                 });
            } else {
                 // Micro Glitch
                 await controls.start({
                     x: [0, 2, -2, 0],
                     transition: { duration: 0.05}
                 });
            }
            
            // Re-trigger loop
            triggerGlitch();
        };

        triggerGlitch();
        
        return () => { isMounted = false; };
    }, [controls, flashControls]);

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
             {/* The Container being distorted */}
             <motion.div className="w-full h-full relative" animate={controls}>
                {children}
             </motion.div>
             
             {/* The Flash Overlay (Cyberpunk red/cyan flash) */}
             <motion.div 
                className="absolute inset-0 mix-blend-overlay pointer-events-none z-20"
                initial={{ opacity: 0 }}
                animate={flashControls}
             />

             {/* Scanline Texture - Persistent CRT Feel */}
             <div className="absolute inset-0 z-10 opacity-[0.05] pointer-events-none mix-blend-multiply"
                  style={{ 
                      backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
                        backgroundSize: '100% 4px, 6px 100%' 
                  }}
             />
             
             {/* Static Noise Grain (Optional, very light) */}
             <div className="absolute inset-0 z-10 opacity-[0.02] pointer-events-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
             />
        </div>
    );
};

// --- Elapsed Timer ---
const ProcessTimer: React.FC<{ isRunning: boolean }> = ({ isRunning }) => {
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef<number | null>(null);

    useEffect(() => {
        if (isRunning) {
            startRef.current = Date.now();
            setElapsed(0);
            const iv = setInterval(() => {
                if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
            }, 1000);
            return () => clearInterval(iv);
        } else {
            startRef.current = null;
        }
    }, [isRunning]);

    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return (
        <span className="text-[9px] font-mono text-slate-500 tabular-nums">
            {m}:{s.toString().padStart(2, '0')} elapsed
        </span>
    );
};

// --- Main Component ---
const ReactorZone: React.FC = () => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [uiError, setUiError] = useState<string | null>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    
    // Settings State
    const [showSettings, setShowSettings] = useState(false);
    const [showYouTubeModal, setShowYouTubeModal] = useState(false);
    const [showWhisperModal, setShowWhisperModal] = useState(false);
    const [splitEngine, setSplitEngine] = useState('demucs');
    const [splitStems, setSplitStems] = useState('4');
    const [splitPasses, setSplitPasses] = useState('1');
    const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
    const [customOutputDir, setCustomOutputDir] = useState<string | null>(null);
    const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null);
    const [youtubeUrl, setYouTubeUrl] = useState('');
    const [youtubeMode, setYouTubeMode] = useState<string>('audio_mp3_320');
    const [youtubeProgress, setYouTubeProgress] = useState<{ message: string; percent: number } | null>(null);
    const [isDownloadingYouTube, setIsDownloadingYouTube] = useState(false);
    const [preSplitConvertWav, setPreSplitConvertWav] = useState(true);
    const [preSplitNormalizeLoudness, setPreSplitNormalizeLoudness] = useState(true);
    const [preSplitHpssPrepass, setPreSplitHpssPrepass] = useState(false);
    const [preSplitProgress, setPreSplitProgress] = useState<{ message: string; percent: number } | null>(null);
    const [isPreprocessing, setIsPreprocessing] = useState(false);
    const [bassEnergy, setBassEnergy] = useState(0);
    const [activeFxStem, setActiveFxStem] = useState<string | null>(null);
    const [whisperPreset, setWhisperPreset] = useState<'none' | 'clean_speech' | 'podcast_voice' | 'noisy_room' | 'phone_call' | 'lyric_slow' | 'vad_clean'>('clean_speech');
    const [whisperModel, setWhisperModel] = useState<'auto' | 'tiny' | 'base' | 'small' | 'medium' | 'large'>('auto');
    const [whisperTask, setWhisperTask] = useState<'transcribe' | 'translate'>('transcribe');
    const [whisperLanguage, setWhisperLanguage] = useState('');
    const [whisperContentType, setWhisperContentType] = useState<'default' | 'music_lyrics' | 'podcast' | 'interview' | 'lecture' | 'meeting'>('default');
    const [whisperProgress, setWhisperProgress] = useState<{ message: string; percent: number } | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [transcriptResult, setTranscriptResult] = useState<WhisperTranscriptionResult | null>(null);
    const [transcriptError, setTranscriptError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { status, progress: progressEvent, progressPercent, result, error, startSeparation, cancel } = useStemSplit();
    const { isTrial, isPro } = useLicense();
    const isFreeMode = isTrial && !isPro;
    const { play, stop } = useSoundSystem();
    const prevStatus = useRef(status);

    const openLicenseModal = useCallback(() => {
        window.dispatchEvent(new CustomEvent('open-license-modal'));
    }, []);

    useEffect(() => {
        if (!isFreeMode) return;
        if (splitEngine !== 'spleeter') setSplitEngine('spleeter');
        if (splitStems !== '2') setSplitStems('2');
        if (splitPasses !== '1') setSplitPasses('1');
    }, [isFreeMode, splitEngine, splitStems, splitPasses]);

    // Track finished stems individually for UI glow
    const [finishedStems, setFinishedStems] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (progressEvent?.message?.startsWith('Saved ')) {
             // Message format: "Saved vocals: ..."
             const parts = progressEvent.message.split(' ');
             if (parts.length >= 2) {
                 const stemName = parts[1].replace(':', '').trim(); 
                 setFinishedStems(prev => new Set(prev).add(stemName));
                 play('stem_active'); 
             }
        }
    }, [progressEvent, play]);
    
    useEffect(() => {
        if (status === StemSplitStatus.PROCESSING) {
            setFinishedStems(new Set());
        }
    }, [status]);

    const stemLabels = useMemo(() => {
        if (splitEngine === 'drumsep') return ['kick', 'snare', 'toms', 'cymbals'];
        if (splitStems === '2') return ['vocals', 'instrumental'];
        if (splitStems === '5') return ['vocals', 'drums', 'bass', 'piano', 'other'];
        if (splitStems === '6') return ['vocals', 'drums', 'bass', 'piano', 'guitar', 'other'];
        return ['vocals', 'drums', 'bass', 'other'];
    }, [splitEngine, splitStems]);

    useEffect(() => {
        if (prevStatus.current !== status) {
            if (status === StemSplitStatus.PROCESSING) play('process_start');
            if (status === StemSplitStatus.COMPLETED) {
                play('success_chime');
                stop('process_loop');
                if (result?.output_directory) {
                    // Open the folder in the default file manager once completion happens!
                    console.log('Attempting to open folder:', result.output_directory);
                    openResultsFolder(result.output_directory).catch(e => console.error('Folder open failed:', e));
                } else {
                    console.warn('Completion signaled but output_directory missing in result');
                }
            }
            if (status === StemSplitStatus.ERROR) {
                play('error_buzz');
                stop('process_loop');
            }
            prevStatus.current = status;
        }
        
    }, [status, play, stop, result]);

    const [pendingFiles, setPendingFiles] = useState<string[]>([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);
    
    // Auto-advance queue
    useEffect(() => {
        if (isProcessingQueue && status === StemSplitStatus.COMPLETED) {
            if (queueIndex < pendingFiles.length - 1) {
                // Wait briefly then start next
                const timeout = setTimeout(() => {
                    setQueueIndex(prev => prev + 1);
                    const nextFile = pendingFiles[queueIndex + 1];
                    setLoadedFilePath(nextFile);
                    play('process_loop');
                    startSeparation(nextFile, {
                        outputDir: customOutputDir || undefined,
                        engine: isFreeMode ? 'spleeter' : splitEngine,
                        stems: isFreeMode ? 2 : parseInt(splitStems),
                        passes: isFreeMode ? 1 : parseInt(splitPasses),
                        format: isFreeMode ? 'mp3' : undefined,
                        applyEffects: !isFreeMode,
                    });
                }, 2000);
                return () => clearTimeout(timeout);
            } else {
                setIsProcessingQueue(false);
                setPendingFiles([]);
                setQueueIndex(0);
            }
        } else if (status === StemSplitStatus.ERROR || status === StemSplitStatus.CANCELLED) {
             // Stop queue on error
             setIsProcessingQueue(false);
        }
    }, [status, isProcessingQueue, queueIndex, pendingFiles, startSeparation, customOutputDir, splitEngine, splitStems, splitPasses, play, isFreeMode]);

    const handleFileSelection = useCallback(async (files: FileList | File[]) => {
        const paths: string[] = [];
        // Convert to array
        const fileArray = Array.from(files);
        
        for (const file of fileArray) {
            const path = (file as File & { path?: string }).path;
            if (path) paths.push(path);
        }

        if (paths.length === 0) {
            setUiError('File path unavailable in browser mode. Please use the desktop app.');
            return;
        }
        
        // Free mode only allows single-file processing
        if (isFreeMode && paths.length > 1) {
            setUiError('Free mode allows single-file processing only. Additional files were ignored.');
            setPendingFiles([]);
            setPendingFilePath(paths[0]);
            setLoadedFilePath(paths[0]);
            setShowSettings(true);
            return;
        }

        // If just one, behave as before
        if (paths.length === 1) {
            setPendingFilePath(paths[0]);
            setLoadedFilePath(paths[0]);
        } else {
            // Bulk mode
            setPendingFiles(paths);
            setPendingFilePath(paths[0]); // Preview first one
            setLoadedFilePath(paths[0]); 
        }
        setShowSettings(true);
    }, [isFreeMode]);

    const handleResplitStem = useCallback((stemPath: string) => {
        // Treat the stem as a new source file for further splitting
        setPendingFiles([stemPath]);
        setPendingFilePath(stemPath);
        // Update loadedFilePath so the "Original Player" plays this stem context
        setLoadedFilePath(stemPath); 
        setShowSettings(true);
        play('click_engage');
    }, [play]);

    const handleOpenDialog = useCallback(async () => {
        if (status === StemSplitStatus.PROCESSING) return;
        setUiError(null);
        play('click_engage');
        try {
            const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
            if (isTauri) {
                const selected = await dialogOpen({
                    multiple: true, // Enable multiple
                    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }]
                });
                
                if (selected) {
                    const paths = Array.isArray(selected) ? selected : [selected];
                    if (paths.length > 0) {
                        if (isFreeMode && paths.length > 1) {
                            setUiError('Free mode allows single-file processing only. Additional files were ignored.');
                            setPendingFiles([]);
                            setPendingFilePath(paths[0]);
                            setLoadedFilePath(paths[0]);
                            setShowSettings(true);
                            return;
                        }

                        if (paths.length === 1) {
                            setPendingFilePath(paths[0]);
                            setLoadedFilePath(paths[0]);
                            setPendingFiles([]);
                        } else {
                            setPendingFiles(paths);
                            setPendingFilePath(paths[0]);
                            setLoadedFilePath(paths[0]);
                        }
                        setShowSettings(true);
                    }
                }
            } else {
                fileInputRef.current?.click();
            }
        } catch (err) {
            console.error("Failed to open dialog", err);
            play('error_buzz');
        }
    }, [play, status, isFreeMode]);

    const handleSelectOutputDir = useCallback(async () => {
        try {
            const selected = await dialogOpen({
                directory: true,
                multiple: false,
                title: 'Select Output Folder for Stems'
            });
            if (selected && typeof selected === 'string') {
                setCustomOutputDir(selected);
            }
        } catch (err) {
            console.error("Failed to select directory", err);
        }
    }, []);

    const handleImportYouTube = useCallback(async () => {
        const trimmedUrl = youtubeUrl.trim();
        if (!trimmedUrl) {
            setUiError('Paste a YouTube URL to import audio.');
            play('error_buzz');
            return;
        }

        setUiError(null);
        setIsDownloadingYouTube(true);
        setYouTubeProgress({ message: 'Preparing YouTube import...', percent: 0 });
        play('click_engage');

        try {
            const result = await downloadYouTubeAudio(trimmedUrl, youtubeMode, (progress) => {
                setYouTubeProgress(progress);
            });

            setPendingFiles([]);
            setPendingFilePath(result.file_path);
            setLoadedFilePath(result.file_path);
            setShowYouTubeModal(false);
            setYouTubeUrl('');
            setYouTubeProgress(null);
            setShowSettings(true);
            play('success_chime');
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            setUiError(detail);
            setYouTubeProgress({ message: detail, percent: 0 });
            play('error_buzz');
        } finally {
            setIsDownloadingYouTube(false);
        }
    }, [play, youtubeUrl, youtubeMode]);

    const handleOpenWhisper = useCallback(() => {
        if (!loadedFilePath && !pendingFilePath) {
            setUiError('Load or import an audio file before opening Whisper transcription.');
            play('error_buzz');
            return;
        }

        setTranscriptError(null);
        setShowWhisperModal(true);
        play('click_engage');
    }, [loadedFilePath, pendingFilePath, play]);

    const handleStartWhisper = useCallback(async () => {
        const targetFile = loadedFilePath || pendingFilePath;
        if (!targetFile) {
            setTranscriptError('No source audio is currently loaded.');
            play('error_buzz');
            return;
        }

        setTranscriptError(null);
        setTranscriptResult(null);
        setWhisperProgress({ message: 'Preparing transcription pipeline...', percent: 0 });
        setIsTranscribing(true);
        play('click_engage');

        try {
            const result = await transcribeAudio({
                inputPath: targetFile,
                preset: whisperPreset,
                model: whisperModel,
                language: whisperLanguage.trim(),
                task: whisperTask,
                contentType: whisperContentType,
            }, (progress) => {
                setWhisperProgress(progress);
            });

            setTranscriptResult(result);
            setWhisperProgress({ message: 'Transcript ready.', percent: 100 });
            play('success_chime');
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            setTranscriptError(detail);
            setWhisperProgress({ message: detail, percent: 0 });
            play('error_buzz');
        } finally {
            setIsTranscribing(false);
        }
    }, [loadedFilePath, pendingFilePath, play, whisperLanguage, whisperModel, whisperPreset, whisperTask, whisperContentType]);

    // --- Analysis Tool Trigger ---
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);

    const handleToolTrigger = useCallback(async (toolId: string) => {
        if (!loadedFilePath && !pendingFilePath) {
            play('error_buzz');
            setUiError('Please load an audio file first.');
            return;
        }

        const targetFile = loadedFilePath || pendingFilePath;
        if (!targetFile) return;

        play('click_engage');

        if (isFreeMode) {
            setUiError('Analysis tools are Pro-only. Free mode supports Spleeter 2-stem, 1-pass MP3 only.');
            play('error_buzz');
            return;
        }
        
        // Handle different tool actions
        if (toolId === 'madmom-bpm' || toolId === 'key-detect' || toolId === 'onset-detect') {
            // Trigger analysis mode
            play('process_start');
            try {
                // We use startSeparation but with engine='analyze'
                // The backend will print JSON to stdout which useStemSplit captures in progress.message
                await startSeparation(targetFile, {
                    engine: 'analyze',
                    outputDir: undefined // No output needed really
                });
            } catch (e) {
                console.error("Analysis trigger failed", e);
                play('error_buzz');
            }
        } else {
            console.log("Tool not yet implemented:", toolId);
        }
    }, [loadedFilePath, pendingFilePath, startSeparation, play, isFreeMode]);

    // Monitor progress for Analysis Result
    useEffect(() => {
        if (status === StemSplitStatus.PROCESSING && progressEvent?.message) {
            if (progressEvent.message.startsWith('ANALYSIS_RESULT: ')) {
                try {
                    const jsonStr = progressEvent.message.replace('ANALYSIS_RESULT: ', '');
                    const data = JSON.parse(jsonStr);
                    console.log("Analysis Data:", data);
                    setAnalysisResult(data);
                    setShowAnalysisModal(true);
                    play('success_chime');
                    // We can technically stop the spinner now, but the backend will likely exit soon after
                } catch (e) {
                    console.error("Failed to parse analysis result", e);
                }
            }
        }
    }, [status, progressEvent, play]);

    const executePendingSplit = useCallback(async () => {
        if (pendingFilePath) {
            setShowSettings(false);
            play('process_loop');
            
            // Check if multiple files pending
            if (pendingFiles.length > 1) {
                // BULK MODE START
                setIsProcessingQueue(true);
                setQueueIndex(0);
                startSeparation(pendingFiles[0], {
                   outputDir: customOutputDir || undefined,
                   engine: isFreeMode ? 'spleeter' : splitEngine,
                   stems: isFreeMode ? 2 : parseInt(splitStems),
                   passes: isFreeMode ? 1 : parseInt(splitPasses),
                   format: isFreeMode ? 'mp3' : undefined,
                   applyEffects: !isFreeMode,
                });
            } else {
                // SINGLE FILE (Classic)
                await startSeparation(pendingFilePath, {
                    outputDir: customOutputDir || undefined,
                    engine: isFreeMode ? 'spleeter' : splitEngine,
                    stems: isFreeMode ? 2 : parseInt(splitStems),
                    passes: isFreeMode ? 1 : parseInt(splitPasses),
                    format: isFreeMode ? 'mp3' : undefined,
                    applyEffects: !isFreeMode,
                });
            }
        }
    }, [pendingFilePath, pendingFiles, startSeparation, play, customOutputDir, splitEngine, splitStems, splitPasses, isFreeMode]);


    // Main render
    return (
        <div className="relative min-h-screen flex flex-col items-center justify-center bg-slate-950 overflow-x-hidden overflow-y-auto">
             
            {/* Custom Title Bar */}
            <TitleBar onToolTrigger={handleToolTrigger} />

            {/* Background Visuals */}
            <GlitchWrapper>
                <ParticleSystem />
            </GlitchWrapper>
            <GlitchWrapper>
                <HoloGrid />
            </GlitchWrapper>
            <CoreVisualizer isProcessing={status === StemSplitStatus.PROCESSING} progress={progressPercent} bassEnergy={bassEnergy} />

            {/* Main UI Zone */}
            <div className="relative z-10 flex flex-col items-center justify-center w-full max-w-2xl mx-auto py-8">
                <div className="flex flex-col items-center mb-4">
                    <GlitchText className="font-display font-bold uppercase text-center" style={{
                        fontSize: '2.8rem',
                        letterSpacing: '0.75em',
                        lineHeight: 1,
                        color: '#e2e8f0',
                        WebkitTextStroke: '0.5px rgba(255,255,255,0.7)',
                        textShadow: '0 1px 0 #94a3b8, 0 2px 0 #64748b, 0 3px 0 #475569, 0 4px 6px rgba(0,0,0,0.6), 0 0 20px rgba(34,211,238,0.15)',
                        textIndent: '0.75em',
                    }}>
                        STEM
                    </GlitchText>
                    
                    <motion.div 
                        className="relative w-64 h-6 my-1 flex items-center justify-center cursor-pointer group"
                        onClick={() => setShowSettings(true)}
                        title="Click to Configure"
                    >
                        {/* Background track (Fixed) */}
                        <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-slate-800 to-transparent opacity-50" />
                        
                        {/* Interactive Beam (Scales) */}
                        <motion.div 
                            className="absolute h-[2px] w-full"
                            style={{ 
                                background: status === StemSplitStatus.ERROR 
                                    ? 'linear-gradient(90deg, transparent, #ef4444, transparent)' 
                                    : status === StemSplitStatus.COMPLETED
                                        ? 'linear-gradient(90deg, transparent, #10b981, transparent)'
                                        : 'linear-gradient(90deg, transparent, #22d3ee, transparent)', // Cyan
                            }}
                            animate={{ 
                                scaleX: status === StemSplitStatus.PROCESSING ? Math.max(0.01, progressPercent / 100) : 1,
                                opacity: status === StemSplitStatus.IDLE ? 0.3 : 1,
                                boxShadow: status === StemSplitStatus.PROCESSING 
                                    ? '0 0 15px rgba(34,211,238,0.5)' 
                                    : status === StemSplitStatus.COMPLETED
                                        ? '0 0 15px rgba(16,185,129,0.5)'
                                        : 'none'
                            }}
                            whileHover={{ opacity: 1, boxShadow: '0 0 10px rgba(34,211,238,0.3)' }}
                            transition={{ type: 'spring', stiffness: 45, damping: 15 }}
                        />
                        
                        {/* Center Fill Indicator (Vertical Growth) */}
                        <AnimatePresence>
                             {status === StemSplitStatus.PROCESSING && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: '16px' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="absolute w-1 rounded-sm overflow-hidden flex items-end z-10"
                                >
                                    {/* Track bg (optional) */}
                                    <div className="absolute inset-0 bg-slate-800/50" />
                                    
                                    {/* Fill */}
                                    <motion.div 
                                        className="w-full bg-cyan-400/90 shadow-[0_0_10px_rgba(34,211,238,0.9)]"
                                        initial={{ height: 0 }}
                                        animate={{ height: `${progressPercent}%` }}
                                        transition={{ type: 'spring', stiffness: 50, damping: 20 }}
                                    />
                                </motion.div>
                             )}
                        </AnimatePresence>
                    </motion.div>

                    <GlitchText className="font-display font-bold uppercase text-center" style={{
                        fontSize: '2.8rem',
                        letterSpacing: '0.75em',
                        lineHeight: 1,
                        color: '#e2e8f0',
                        WebkitTextStroke: '0.5px rgba(255,255,255,0.7)',
                        textShadow: '0 1px 0 #94a3b8, 0 2px 0 #64748b, 0 3px 0 #475569, 0 4px 6px rgba(0,0,0,0.6), 0 0 20px rgba(34,211,238,0.15)',
                        textIndent: '0.75em',
                    }}>
                        SPLIT
                    </GlitchText>

                    {isFreeMode && (
                        <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35 }}
                            className="mt-5 w-full max-w-xl"
                        >
                            <div className="relative overflow-hidden rounded-xl border border-amber-500/35 bg-slate-900/80 backdrop-blur-md shadow-[0_0_24px_rgba(245,158,11,0.15)]">
                                <div className="absolute inset-0 opacity-[0.07] pointer-events-none bg-[linear-gradient(rgba(245,158,11,0.16)_1px,transparent_1px)] bg-[size:100%_3px]" />
                                <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700" />
                                <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="pl-2">
                                        <p className="font-mono text-[10px] tracking-[0.24em] text-amber-400/90 uppercase">Free Plan Active</p>
                                        <p className="font-mono text-xs text-slate-300 mt-1">Spleeter • 2 stems • 1 pass • MP3 output</p>
                                    </div>
                                    <button
                                        onClick={openLicenseModal}
                                        className="group relative px-4 py-2 rounded-md border border-amber-400/50 text-amber-300 hover:text-slate-950 font-mono text-[10px] tracking-[0.2em] uppercase transition-all duration-200 overflow-hidden"
                                        title="Unlock full Pro processing"
                                    >
                                        <span className="absolute inset-0 bg-gradient-to-r from-amber-500 to-amber-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <span className="relative">Upgrade To Pro</span>
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* Error display */}
                <AnimatePresence>
                    {status === StemSplitStatus.ERROR && (
                        <motion.div
                            key="error"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="mb-4 px-4 py-2 rounded border border-red-500/30 bg-red-950/30 backdrop-blur-sm"
                        >
                            <span className="text-red-400 font-mono text-xs">{error instanceof Error ? error.message : (error || 'An error occurred.')}</span>
                        </motion.div>
                    )}
                    {uiError && (
                        <motion.div
                            key="ui-error"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="mb-4 px-4 py-2 rounded border border-red-500/30 bg-red-950/30 backdrop-blur-sm"
                        >
                            <span className="text-red-400 font-mono text-xs">{uiError}</span>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Drop Zone / Progress Bar */}
                <div
                    ref={dropZoneRef}
                    className={`relative w-full max-w-md rounded-lg transition-all duration-500 overflow-hidden ${
                        status === StemSplitStatus.PROCESSING
                            ? 'h-28 border border-cyan-500/10 bg-slate-950/30 backdrop-blur-sm cursor-not-allowed'
                            : status === StemSplitStatus.COMPLETED
                            ? 'h-14 border border-emerald-500/10 bg-slate-950/20 backdrop-blur-[2px] cursor-pointer'
                            : isDragOver
                            ? 'h-40 border-2 border-dashed border-cyan-400 bg-cyan-900/5 cursor-pointer'
                            : 'h-40 border-2 border-dashed border-slate-700/50 bg-slate-900/15 cursor-pointer'
                    }`}
                    onClick={status === StemSplitStatus.PROCESSING ? undefined : handleOpenDialog}
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={e => { e.preventDefault(); setIsDragOver(false); }}
                    onDrop={async e => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (status === StemSplitStatus.PROCESSING) return;
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            setUiError(null);
                            await handleFileSelection(Array.from(e.dataTransfer.files));
                        }
                    }}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".wav,.mp3,.flac,.ogg,.m4a"
                        className="hidden"
                        title="Select audio file for stem separation"
                        onChange={async (e) => {
                            const inputEl = e.currentTarget;
                            if (inputEl.files && inputEl.files.length > 0) {
                                setUiError(null);
                                await handleFileSelection(Array.from(inputEl.files));
                            }
                            inputEl.value = '';
                        }}
                    />

                    <AnimatePresence mode="wait">
                        {/* IDLE state: drop prompt */}
                        {(status === StemSplitStatus.IDLE || status === StemSplitStatus.ERROR || status === StemSplitStatus.CANCELLED) && (
                            <motion.div
                                key="drop-idle"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.3 }}
                                className="absolute inset-0 flex flex-col items-center justify-center"
                            >
                                <svg className="w-8 h-8 text-slate-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                </svg>
                                <span className="text-cyan-300 font-mono text-sm">Drop audio file here</span>
                                <span className="text-slate-500 font-mono text-[10px] mt-1">or click to select · WAV MP3 FLAC OGG M4A</span>
                            </motion.div>
                        )}

                        {/* PROCESSING state: progress bar */}
                        {status === StemSplitStatus.PROCESSING && (
                            <motion.div
                                key="progress-bar"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.4 }}
                                className="absolute inset-0 flex flex-col justify-center px-5 py-3"
                            >
                                {/* Top row: step info + percentage */}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        {/* Animated spinner */}
                                        <motion.div
                                            className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full"
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                                        />
                                        <span className="text-[11px] font-mono text-cyan-300 truncate max-w-[240px]">
                                            {progressEvent?.message || 'Initializing...'}
                                        </span>
                                    </div>
                                    <span className="text-[11px] font-mono text-cyan-400 tabular-nums font-bold">
                                        {progressPercent}%
                                    </span>
                                </div>

                                {/* Progress bar track */}
                                <div className="relative w-full h-2.5 rounded-full bg-slate-800/80 border border-slate-700/50 overflow-hidden">
                                    {/* Animated gradient fill */}
                                    <motion.div
                                        className="absolute inset-y-0 left-0 rounded-full"
                                        style={{
                                            background: 'linear-gradient(90deg, #0891b2, #22d3ee, #67e8f9)',
                                            boxShadow: '0 0 12px rgba(34,211,238,0.5), 0 0 4px rgba(34,211,238,0.8)',
                                        }}
                                        initial={{ width: '0%' }}
                                        animate={{ width: `${progressPercent}%` }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                    />
                                    {/* Shimmer sweep overlay */}
                                    <motion.div
                                        className="absolute inset-0 rounded-full"
                                        style={{
                                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                                            backgroundSize: '200% 100%',
                                        }}
                                        animate={{ backgroundPosition: ['200% 0%', '-200% 0%'] }}
                                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                    />
                                </div>

                                {/* Bottom row: step counter + elapsed */}
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-[9px] font-mono text-slate-500 tracking-wider uppercase">
                                        {isProcessingQueue 
                                            ? `FILE ${queueIndex + 1}/${pendingFiles.length} • STEP ${progressEvent?.step ?? 0}/${progressEvent?.total_steps ?? '—'}`
                                            : `Step ${progressEvent?.step ?? 0} / ${progressEvent?.total_steps ?? '—'}`
                                        }
                                    </span>
                                    <ProcessTimer isRunning={status === StemSplitStatus.PROCESSING} />
                                </div>

                                {/* Cancel hint */}
                                <div className="flex justify-center mt-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); cancel(); }}
                                        className="text-[9px] font-mono text-slate-600 hover:text-red-400 transition-colors tracking-wider uppercase"
                                    >
                                        [ CANCEL ]
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* COMPLETED state: compact done banner */}
                        {status === StemSplitStatus.COMPLETED && (
                            <motion.div
                                key="progress-done"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                className="absolute inset-0 flex items-center justify-center gap-3 px-5 flex-col py-1"
                            >
                                <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-[11px] font-mono text-emerald-400">
                                    {isProcessingQueue ? `Batch Completed (${pendingFiles.length} files)` : 'Split Complete'}
                                </span>
                                </div>
                                {isProcessingQueue ? (
                                    <span className="text-[9px] font-mono text-emerald-600/70">All files processed successfully</span>
                                ) : (
                                    <span className="text-[9px] font-mono text-slate-500">— click to split another</span>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Stem Results / LED Indicators (during processing) */}
                <AnimatePresence>
                    {status !== StemSplitStatus.COMPLETED && (
                        <motion.div 
                            key="stem-leds"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-4 flex gap-8 perspective-500"
                        >
                            {stemLabels.map((stem, i) => {
                                const isFinished = finishedStems.has(stem);
                                const stemData = result?.stems?.[stem];
                                const purity = stemData?.purity_score;
                                return (
                                    <StatusLED key={stem} label={stem} isActive={isFinished} score={purity} />
                                );
                            })}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Stem Players (slide in on completion) */}
                <AnimatePresence>
                    {status === StemSplitStatus.COMPLETED && result?.stems && (
                        <motion.div
                            key="stem-players"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="mt-4 w-full max-w-xl space-y-3"
                        >
                            {/* Section header */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                                className="flex items-center gap-2 px-1 mb-2"
                            >
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                                <span className="text-[9px] font-mono tracking-[0.3em] text-cyan-500/60 uppercase whitespace-nowrap">
                                    {Object.keys(result.stems).length} Stems Ready
                                </span>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                            </motion.div>

                            {/* Player cards */}
                            {Object.entries(result.stems).map(([name, info], idx) => (
                                <StemPlayer
                                    key={name}
                                    stemName={name}
                                    filePath={info.file_path}
                                    duration={info.duration_seconds}
                                    purityScore={info.purity_score}
                                    index={idx}
                                    isFxOpen={activeFxStem === name}
                                    onToggleFX={() => setActiveFxStem(prev => prev === name ? null : name)}
                                    onResplitStem={isFreeMode ? undefined : () => handleResplitStem(info.file_path)}
                                    fxDisabled={isFreeMode}
                                    resplitDisabled={isFreeMode}
                                />
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
                
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <button 
                        onClick={() => setShowSettings(true)}
                        className="px-4 py-2 border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-800 rounded font-mono text-xs transition-colors"
                    >
                        [ CONFIG OPTIONS ]
                    </button>
                    <button 
                        onClick={() => {
                            setUiError(null);
                            setYouTubeProgress(null);
                            setShowYouTubeModal(true);
                            play('click_engage');
                        }}
                        className="px-4 py-2 border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-700 rounded font-mono text-xs transition-colors shadow-[0_0_10px_rgba(34,211,238,0.12)]"
                    >
                        [ YOUTUBE IMPORT ]
                    </button>
                    <button 
                        onClick={handleOpenWhisper}
                        disabled={!loadedFilePath && !pendingFilePath}
                        className={`px-4 py-2 rounded font-mono text-xs transition-colors ${loadedFilePath || pendingFilePath
                            ? 'border border-cyan-500/30 text-cyan-100 hover:bg-cyan-900/40 hover:border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.16)]'
                            : 'border border-slate-800 text-slate-600 cursor-not-allowed'
                        }`}
                    >
                        [ WHISPER TRANSCRIPT ]
                    </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500">
                    <span>{loadedFilePath || pendingFilePath ? 'Source Ready' : 'No Source Loaded'}</span>
                    {(loadedFilePath || pendingFilePath) && (
                        <span className="text-cyan-500/70">Transcript and YouTube ingest follow Cyber-HUD pipeline styling</span>
                    )}
                </div>
            </div>

            {/* Config Modal */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => {
                            setShowSettings(false);
                            if (pendingFilePath) setPendingFilePath(null);
                        }}
                    >
                        <motion.div 
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 20 }}
                            className="bg-slate-900 border border-cyan-900/50 p-6 rounded-xl w-full max-w-md shadow-2xl shadow-cyan-900/20"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h2 className="text-cyan-400 font-mono text-xl mb-4 border-b border-slate-800 pb-2">Separation Configuration</h2>
                            
                            <div className="space-y-4 font-mono text-sm text-slate-300">
                                {isFreeMode && (
                                    <div className="bg-amber-900/20 border border-amber-700/50 rounded p-3 text-amber-300 text-xs">
                                        Free mode is locked to Spleeter, 2 stems, 1 pass, MP3 output.
                                    </div>
                                )}
                                {pendingFilePath && (
                                    <div className="bg-cyan-900/20 border border-cyan-800 p-2 rounded text-xs mb-4 text-cyan-200 break-all">
                                        <span className="text-cyan-500 font-bold block mb-1">
                                            {pendingFiles.length > 1 ? `BATCH JOB (${pendingFiles.length} FILES)` : 'READY TO SPLIT:'}
                                        </span>
                                        {pendingFiles.length > 1 ? (
                                            <div className="max-h-20 overflow-y-auto mt-1 space-y-1">
                                                {pendingFiles.map((f, i) => (
                                                    <div key={i} className="text-slate-400 text-[10px] truncate">{i+1}. {f.split(/[\\/]/).pop()}</div>
                                                ))}
                                            </div>
                                        ) : (
                                            pendingFilePath.split(/[\\/]/).pop()
                                        )}
                                    </div>
                                )}
                                <div>
                                    <label className="block mb-1 text-slate-400">Engine Output</label>
                                    <select 
                                        value={splitEngine} onChange={e => {
                                            setSplitEngine(e.target.value);
                                            // Spleeter only does 2, 4, 5 stems
                                            if (e.target.value === 'spleeter' && splitStems === '6') {
                                                setSplitStems('4');
                                            }
                                            // Drumsep only does 4 stems (kick, snare, cymbals, toms)
                                            if (e.target.value === 'drumsep') {
                                                setSplitStems('4');
                                            }
                                        }}
                                        className={`w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none ${isFreeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        title="Select the audio separation engine"
                                        disabled={isFreeMode}
                                    >
                                        <option value="demucs">Demucs (V4, Hybrid)</option>
                                        <option value="mdx">MDX-Net (Quality focus)</option>
                                        <option value="roformer">Roformer (Ultra Quality)</option>
                                        <option value="spleeter">Spleeter (Fast)</option>
                                        <option value="drumsep">Drumsep (Kick/Snare/Tom/Cymbal)</option>
                                    </select>
                                </div>
                                
                                <div>
                                    <label className="block mb-1 text-slate-400">Number of Stems</label>
                                    <select 
                                        value={splitStems} onChange={e => setSplitStems(e.target.value)}
                                        className={`w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none ${isFreeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        title="Select the number of stems to separate"
                                        disabled={isFreeMode}
                                    >
                                        <option value="2" disabled={splitEngine === 'drumsep'}>2-Stem (Vocal / Instrumental)</option>
                                        <option value="4">
                                            {splitEngine === 'drumsep' ? '4-Stem (Kick, Snare, Toms, Cymbals)' : '4-Stem (Vocal, Drum, Bass, Other)'}
                                        </option>
                                        <option value="5" disabled={splitEngine === 'drumsep' || splitEngine === 'roformer'}>5-Stem (Adds Piano/Keys)</option>
                                        <option value="6" disabled={splitEngine === 'spleeter' || splitEngine === 'drumsep' || splitEngine === 'roformer'}>6-Stem {splitEngine === 'spleeter' ? '(Not Supported)' : '(Guitar, Piano, etc.)'}</option>
                                    </select>
                                    {splitEngine === 'drumsep' && <span className="text-[10px] text-orange-400 mt-1 block">Drumsep strictly breaks down drums into Kick, Snare, Toms, and Cymbals.</span>}
                                    {splitEngine === 'roformer' && <span className="text-[10px] text-cyan-400 mt-1 block">Roformer is optimized for 2-stem or 4-stem extraction.</span>}
                                </div>
                                
                                <div>
                                    <label className="block mb-1 text-slate-400">Processing Passes</label>
                                    <select 
                                        value={splitPasses} onChange={e => setSplitPasses(e.target.value)}
                                        className={`w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none ${isFreeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        title="Select the number of processing passes"
                                        disabled={splitEngine === 'spleeter' || isFreeMode}
                                    >
                                        <option value="1">1 Pass (Faster)</option>
                                        <option value="2">2 Passes (Cleaner bleeding)</option>
                                        <option value="3">3 Passes (Maximum Quality)</option>
                                    </select>
                                    {splitEngine === 'spleeter' && <span className="text-[10px] text-orange-400 mt-1 block">Passes not available for Spleeter</span>}
                                    {isFreeMode && <span className="text-[10px] text-amber-300 mt-1 block">Output is locked to MP3 in free mode.</span>}
                                </div>

                                <div className="border-t border-slate-800 pt-4 mt-4">
                                    <h3 className="text-cyan-400 font-mono text-sm mb-3 flex items-center gap-2">
                                        <span className="text-xs">PRE-SPLIT QUALITY</span>
                                    </h3>
                                    <div className="space-y-3 text-xs">
                                        <label className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={preSplitConvertWav}
                                                onChange={(e) => setPreSplitConvertWav(e.target.checked)}
                                                className="w-4 h-4 accent-cyan-500"
                                                title="Convert lossy formats (MP3, AAC) to lossless PCM WAV before splitting"
                                            />
                                            <span>Convert to WAV</span>
                                            <span className="text-slate-500">(eliminates codec artifacts)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={preSplitNormalizeLoudness}
                                                onChange={(e) => setPreSplitNormalizeLoudness(e.target.checked)}
                                                className="w-4 h-4 accent-cyan-500"
                                                title="Normalize audio to -16 LUFS to prevent separator overload"
                                            />
                                            <span>Normalize Loudness</span>
                                            <span className="text-slate-500">(-16 LUFS target)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={preSplitHpssPrepass}
                                                onChange={(e) => setPreSplitHpssPrepass(e.target.checked)}
                                                disabled={isFreeMode}
                                                className={`w-4 h-4 accent-cyan-500 ${isFreeMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                title="Split into harmonic/percussive domains before separation (slower)"
                                            />
                                            <span>HPSS Pre-pass</span>
                                            <span className="text-slate-500">(slower, cleaner drums)</span>
                                        </label>
                                        <p className="text-slate-500 italic text-[10px] mt-2 leading-relaxed">
                                            Preprocessing passes run before the stem separator. Recommended: WAV conversion only for most sources.
                                        </p>
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block mb-1 text-slate-400">Output Folder</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            value={customOutputDir || ""}
                                            placeholder="Default (Same as input file)"
                                            readOnly
                                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-slate-400 text-xs truncate cursor-default"
                                            title={customOutputDir || "Output will be saved in a new folder next to the source audio"}
                                        />
                                        <button
                                            onClick={handleSelectOutputDir}
                                            className="px-3 py-1 bg-slate-800 border border-slate-600 rounded text-xs hover:bg-slate-700 text-slate-300 whitespace-nowrap"
                                        >
                                            Select...
                                        </button>
                                        {customOutputDir && (
                                            <button
                                                onClick={() => setCustomOutputDir(null)}
                                                className="px-2 py-1 bg-red-900/30 border border-red-900/50 rounded text-xs hover:bg-red-900/50 text-red-400"
                                                title="Reset to default"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-2 text-xs text-slate-500 italic">
                                    {customOutputDir 
                                        ? "Files will be saved to specified folder."
                                        : <span>Files are saved to a <span className="text-slate-400">&quot;Source Name Stems&quot;</span> folder alongside the original audio file.</span>
                                    }
                                </div>
                            </div>
                            
                            <div className="mt-6 flex justify-end gap-3">
                                <button 
                                    onClick={() => {
                                        setShowSettings(false);
                                        setPendingFilePath(null);
                                    }}
                                    className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={() => {
                                        if (pendingFilePath) {
                                            executePendingSplit();
                                        } else {
                                            setShowSettings(false);
                                        }
                                    }}
                                    className={`px-6 py-2 bg-cyan-900 border border-cyan-500 rounded text-cyan-50 hover:bg-cyan-800 transition-colors font-bold shadow-lg shadow-cyan-900/50 ${
                                       pendingFiles.length > 1 ? "animate-pulse" : "" 
                                    }`}
                                >
                                    {pendingFiles.length > 1 && !isFreeMode ? `SPLIT BATCH (${pendingFiles.length})` : pendingFilePath ? (isFreeMode ? 'EXECUTE FREE SPLIT' : 'EXECUTE SPLIT') : 'Save Config'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showYouTubeModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => {
                            if (!isDownloadingYouTube) {
                                setShowYouTubeModal(false);
                            }
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 20 }}
                            className="w-full max-w-md rounded-xl border border-cyan-900/50 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-cyan-900/20 overflow-hidden"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
                                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-500">Source Ingest</p>
                                <h2 className="mt-1 font-mono text-xl text-cyan-300">YouTube Audio Import</h2>
                                <p className="mt-2 text-xs text-slate-400">Import a track, cache it locally, then drop directly into the existing split configuration pipeline.</p>
                            </div>

                            <div className="space-y-4 px-6 py-5 font-mono text-sm text-slate-300">
                                <div className="rounded-xl border border-slate-700/50 bg-slate-900 p-4 shadow-[0_0_10px_rgba(34,211,238,0.08)]">
                                    <label className="mb-2 block text-[10px] uppercase tracking-[0.24em] text-slate-500">YouTube URL</label>
                                    <input
                                        value={youtubeUrl}
                                        onChange={(event) => setYouTubeUrl(event.target.value)}
                                        placeholder="https://www.youtube.com/watch?v=..."
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none text-xs"
                                        disabled={isDownloadingYouTube}
                                    />
                                    <p className="mt-2 text-[10px] text-slate-500">The imported MP3 is staged locally, then becomes the active source for split or transcript workflows.</p>
                                </div>

                                <div className="rounded-xl border border-slate-700/50 bg-slate-900 p-4 shadow-[0_0_10px_rgba(34,211,238,0.08)]">
                                    <label className="mb-3 block text-[10px] uppercase tracking-[0.24em] text-slate-500">Download Format</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 mb-2">Audio Formats</p>
                                            {['audio_mp3_320', 'audio_mp3_192', 'audio_mp3_128', 'audio_wav', 'audio_flac'].map((mode) => (
                                                <label key={mode} className="flex items-center gap-2 mb-2 cursor-pointer hover:bg-slate-800 p-1.5 rounded">
                                                    <input
                                                        type="radio"
                                                        name="youtube-mode"
                                                        value={mode}
                                                        checked={youtubeMode === mode}
                                                        onChange={(e) => setYouTubeMode(e.target.value)}
                                                        disabled={isDownloadingYouTube}
                                                        className="w-3 h-3"
                                                    />
                                                    <span className="text-xs text-slate-300">
                                                        {mode.includes('320') && 'MP3 320kbps'}
                                                        {mode.includes('192') && 'MP3 192kbps'}
                                                        {mode.includes('128') && 'MP3 128kbps'}
                                                        {mode === 'audio_wav' && 'WAV'}
                                                        {mode === 'audio_flac' && 'FLAC'}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <div>
                                            <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 mb-2">Video Formats</p>
                                            {['video_360p', 'video_720p', 'video_1080p'].map((mode) => (
                                                <label key={mode} className="flex items-center gap-2 mb-2 cursor-pointer hover:bg-slate-800 p-1.5 rounded">
                                                    <input
                                                        type="radio"
                                                        name="youtube-mode"
                                                        value={mode}
                                                        checked={youtubeMode === mode}
                                                        onChange={(e) => setYouTubeMode(e.target.value)}
                                                        disabled={isDownloadingYouTube}
                                                        className="w-3 h-3"
                                                    />
                                                    <span className="text-xs text-slate-300">
                                                        {mode === 'video_360p' && '360p'}
                                                        {mode === 'video_720p' && '720p HD'}
                                                        {mode === 'video_1080p' && '1080p FHD'}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-700/50 bg-slate-950/90 p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="relative flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                                            <motion.div
                                                className={`h-2 w-2 rounded-full ${isDownloadingYouTube ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]' : youtubeProgress?.percent === 100 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]' : 'bg-slate-700'}`}
                                                animate={isDownloadingYouTube ? { opacity: [0.4, 1, 0.4], scale: [1, 1.4, 1] } : { opacity: 1, scale: 1 }}
                                                transition={{ duration: 1.8, repeat: isDownloadingYouTube ? Infinity : 0 }}
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Import Telemetry</p>
                                            <p className="mt-1 text-xs text-cyan-50">{youtubeProgress?.message || 'Awaiting URL input.'}</p>
                                        </div>
                                        <span className="text-[10px] tabular-nums text-slate-500">{youtubeProgress?.percent ?? 0}%</span>
                                    </div>
                                    <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                                        <motion.div
                                            className="h-full bg-gradient-to-r from-cyan-500/70 via-cyan-400 to-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                                            animate={{ width: `${youtubeProgress?.percent ?? 0}%` }}
                                            transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                                        />
                                    </div>
                                </div>

                                {uiError && showYouTubeModal && (
                                    <div className="rounded border border-red-500/30 bg-red-950/30 px-4 py-2 text-xs text-red-300 backdrop-blur-sm">
                                        {uiError}
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 border-t border-slate-800 bg-slate-900/80 px-6 py-4">
                                <button
                                    onClick={() => setShowYouTubeModal(false)}
                                    disabled={isDownloadingYouTube}
                                    className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleImportYouTube}
                                    disabled={isDownloadingYouTube}
                                    className="px-6 py-2 bg-cyan-900 border border-cyan-500 rounded text-cyan-50 hover:bg-cyan-800 transition-colors font-bold shadow-lg shadow-cyan-900/50 disabled:opacity-60"
                                >
                                    {isDownloadingYouTube ? 'IMPORTING...' : 'IMPORT AUDIO'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showWhisperModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => {
                            if (!isTranscribing) {
                                setShowWhisperModal(false);
                            }
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 20 }}
                            className="w-full max-w-2xl rounded-2xl border border-cyan-900/50 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-cyan-900/20 overflow-hidden"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
                                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-500">Whisper Module</p>
                                <h2 className="mt-1 font-mono text-xl text-cyan-300">Transcription Console</h2>
                                <p className="mt-2 text-xs text-slate-400">Generate a transcript or translated subtitle pass for the currently loaded source using the same Cyber-HUD control language.</p>
                            </div>

                            <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.1fr_0.9fr]">
                                <div className="space-y-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <label className="block mb-1 text-slate-400 text-[10px] uppercase tracking-[0.24em]">Preprocess Preset</label>
                                            <select
                                                value={whisperPreset}
                                                onChange={(event) => setWhisperPreset(event.target.value as typeof whisperPreset)}
                                                title="Whisper preprocess preset"
                                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none"
                                                disabled={isTranscribing}
                                            >
                                                <option value="clean_speech">Clean Speech</option>
                                                <option value="podcast_voice">Podcast Voice</option>
                                                <option value="noisy_room">Noisy Room</option>
                                                <option value="phone_call">Phone Call</option>
                                                <option value="lyric_slow">Lyric Slow (0.80x)</option>
                                                <option value="vad_clean">VAD Clean</option>
                                                <option value="none">None</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block mb-1 text-slate-400 text-[10px] uppercase tracking-[0.24em]">Whisper Model</label>
                                            <select
                                                value={whisperModel}
                                                onChange={(event) => setWhisperModel(event.target.value as typeof whisperModel)}
                                                title="Whisper model selection"
                                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none"
                                                disabled={isTranscribing}
                                            >
                                                <option value="auto">Auto</option>
                                                <option value="tiny">Tiny</option>
                                                <option value="base">Base</option>
                                                <option value="small">Small</option>
                                                <option value="medium">Medium</option>
                                                <option value="large">Large</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block mb-1 text-slate-400 text-[10px] uppercase tracking-[0.24em]">Task</label>
                                            <select
                                                value={whisperTask}
                                                onChange={(event) => setWhisperTask(event.target.value as typeof whisperTask)}
                                                title="Whisper transcription task"
                                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none"
                                                disabled={isTranscribing}
                                            >
                                                <option value="transcribe">Transcribe</option>
                                                <option value="translate">Translate to English</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block mb-1 text-slate-400 text-[10px] uppercase tracking-[0.24em]">Language Hint</label>
                                            <input
                                                value={whisperLanguage}
                                                onChange={(event) => setWhisperLanguage(event.target.value)}
                                                placeholder="Auto detect"
                                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none text-xs"
                                                disabled={isTranscribing}
                                            />
                                        </div>
                                        <div>
                                            <label className="block mb-1 text-slate-400 text-[10px] uppercase tracking-[0.24em]">Content Type Hint</label>
                                            <select
                                                value={whisperContentType}
                                                onChange={(event) => setWhisperContentType(event.target.value as typeof whisperContentType)}
                                                title="Content type for Whisper hints"
                                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-cyan-50 focus:border-cyan-500 outline-none"
                                                disabled={isTranscribing}
                                            >
                                                <option value="default">Default</option>
                                                <option value="music_lyrics">Music Lyrics</option>
                                                <option value="podcast">Podcast</option>
                                                <option value="interview">Interview</option>
                                                <option value="lecture">Lecture</option>
                                                <option value="meeting">Meeting</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-700/50 bg-slate-950/90 p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="relative flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                                                <motion.div
                                                    className={`h-2 w-2 rounded-full ${isTranscribing ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]' : transcriptResult ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]' : transcriptError ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]' : 'bg-slate-700'}`}
                                                    animate={isTranscribing ? { opacity: [0.4, 1, 0.4], scale: [1, 1.4, 1] } : { opacity: 1, scale: 1 }}
                                                    transition={{ duration: 2, repeat: isTranscribing ? Infinity : 0 }}
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Transcription Telemetry</p>
                                                <p className="mt-1 text-xs text-cyan-50">{whisperProgress?.message || 'Ready to run Whisper.'}</p>
                                            </div>
                                            <span className="text-[10px] tabular-nums text-slate-500">{whisperProgress?.percent ?? 0}%</span>
                                        </div>
                                        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                                            <motion.div
                                                className="h-full bg-gradient-to-r from-cyan-500/70 via-cyan-400 to-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                                                animate={{ width: `${whisperProgress?.percent ?? 0}%` }}
                                                transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                                            />
                                        </div>
                                        {transcriptError && (
                                            <div className="mt-3 rounded border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                                                {transcriptError}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-700/50 bg-slate-950/90 p-4 flex flex-col">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Transcript Preview</p>
                                            <p className="mt-1 text-xs text-slate-400">TXT, JSON, SRT, and VTT output formats. Word-level timestamps in .word.srt (optional).</p>
                                        </div>
                                        {transcriptResult?.detected_language && (
                                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                                                {transcriptResult.detected_language.toUpperCase()}
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-4 min-h-[220px] flex-1 rounded-lg border border-slate-800 bg-slate-950/70 p-4 overflow-y-auto">
                                        {transcriptResult ? (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-3 gap-3 text-[10px] uppercase tracking-[0.24em] text-slate-500">
                                                    <div>
                                                        <span className="block text-slate-600">Model</span>
                                                        <span className="mt-1 block text-cyan-300 text-xs normal-case tracking-normal">{transcriptResult.model}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-slate-600">Segments</span>
                                                        <span className="mt-1 block text-cyan-300 text-xs normal-case tracking-normal">{transcriptResult.segment_count}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-slate-600">Content Type</span>
                                                        <span className="mt-1 block text-cyan-300 text-xs normal-case tracking-normal">{transcriptResult.content_type}</span>
                                                    </div>
                                                </div>
                                                <div className="h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                                                <div className="space-y-2">
                                                    <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Output Files:</p>
                                                    <div className="text-[9px] space-y-1 text-slate-300 font-mono">
                                                        <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {transcriptResult.text_file.split('\\').pop()}</div>
                                                        <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {transcriptResult.json_file.split('\\').pop()}</div>
                                                        <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {transcriptResult.srt_file.split('\\').pop()}</div>
                                                        <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {transcriptResult.vtt_file.split('\\').pop()}</div>
                                                        {transcriptResult.word_srt_file && (
                                                            <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {transcriptResult.word_srt_file.split('\\').pop()}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                                                <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-200 font-mono">{transcriptResult.transcript_preview || 'Transcript completed. Open the output folder to inspect the generated files.'}</pre>
                                            </div>
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-center text-xs text-slate-500 font-mono uppercase tracking-[0.2em]">
                                                Transcript preview will appear here after Whisper finishes.
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 flex flex-wrap justify-end gap-3">
                                        {transcriptResult && (
                                            <>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(transcriptResult.transcript_preview || '')}
                                                    className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 transition-colors text-xs"
                                                >
                                                    COPY PREVIEW
                                                </button>
                                                <button
                                                    onClick={() => openResultsFolder(transcriptResult.output_directory)}
                                                    className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 transition-colors text-xs"
                                                >
                                                    OPEN FOLDER
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 border-t border-slate-800 bg-slate-900/80 px-6 py-4">
                                <button
                                    onClick={() => setShowWhisperModal(false)}
                                    disabled={isTranscribing}
                                    className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={handleStartWhisper}
                                    disabled={isTranscribing}
                                    className="px-6 py-2 bg-cyan-900 border border-cyan-500 rounded text-cyan-50 hover:bg-cyan-800 transition-colors font-bold shadow-lg shadow-cyan-900/50 disabled:opacity-60"
                                >
                                    {isTranscribing ? 'TRANSCRIBING...' : 'RUN WHISPER'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Analysis Result Modal */}
            <AnimatePresence>
                {showAnalysisModal && analysisResult && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
                        onClick={() => setShowAnalysisModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 30 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 30 }}
                            className="bg-slate-950 border border-cyan-500/30 p-0 rounded-2xl w-full max-w-2xl shadow-2xl shadow-cyan-900/40 overflow-hidden relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="bg-slate-900/50 p-6 border-b border-cyan-900/30 flex justify-between items-start">
                                <div>
                                    <h2 className="text-cyan-400 font-mono text-2xl tracking-tight flex items-center gap-2">
                                        <span className="text-3xl">⌬</span> ANALYSIS REPORT
                                    </h2>
                                    <p className="text-slate-500 font-mono text-xs mt-1 uppercase tracking-widest">
                                        {analysisResult.filename}
                                    </p>
                                </div>
                                <button 
                                    onClick={() => setShowAnalysisModal(false)}
                                    className="text-slate-500 hover:text-red-400 transition-colors text-xl"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Content Grid */}
                            <div className="p-8 grid grid-cols-2 gap-8">
                                {/* BPM & Key - Large Display */}
                                <div className="space-y-6">
                                    <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-800/50 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <span className="text-6xl">⏱</span>
                                        </div>
                                        <label className="text-slate-500 text-[10px] font-mono uppercase tracking-widest block mb-1">Detected BPM</label>
                                        <div className="text-5xl font-mono font-bold text-cyan-50 tabular-nums">
                                            {analysisResult.bpm || '---'}
                                        </div>
                                    </div>
                                    
                                    <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-800/50 relative overflow-hidden group">
                                          <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <span className="text-6xl">🎹</span>
                                        </div>
                                        <label className="text-slate-500 text-[10px] font-mono uppercase tracking-widest block mb-1">Musical Key</label>
                                        <div className="text-5xl font-mono font-bold text-purple-200">
                                            {analysisResult.key || '---'}
                                        </div>
                                    </div>
                                </div>

                                {/* Detailed Metrics */}
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">Global Pitch (Avg)</label>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-mono text-emerald-400">{analysisResult.pitch_hz}</span>
                                            <span className="text-slate-600 text-xs font-bold">Hz</span>
                                        </div>
                                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500/50 w-1/2" style={{ width: `${Math.min(100, (analysisResult.pitch_hz / 1000) * 100)}%` }} />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">Integrated Loudness</label>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-mono text-rose-400">{analysisResult.lufs}</span>
                                            <span className="text-slate-600 text-xs font-bold">LUFS</span>
                                        </div>
                                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                             {/* Map -60 to 0 range roughly to 0-100% */}
                                            <div className="h-full bg-rose-500/50" style={{ width: `${Math.max(0, (analysisResult.lufs + 60) / 60 * 100)}%` }} />
                                        </div>
                                    </div>

                                    <div className="space-y-1 pt-2">
                                        <label className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">Transient Density</label>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-2xl font-mono text-sky-400">{analysisResult.onsets_count || 0}</span>
                                            <span className="text-slate-600 text-xs font-bold">Events Detected</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Footer / Actions */}
                            <div className="bg-slate-900/80 p-4 border-t border-cyan-900/30 flex justify-end gap-3 backdrop-blur-sm">
                                <button
                                    onClick={() => {
                                        // Copy to clipboard
                                        const text = `BPM: ${analysisResult.bpm}\nKey: ${analysisResult.key}\nLUFS: ${analysisResult.lufs}`;
                                        navigator.clipboard.writeText(text);
                                        play('hover_tick');
                                    }}
                                    className="px-4 py-2 rounded border border-slate-700 hover:bg-slate-800 text-slate-400 text-xs font-mono transition-colors"
                                >
                                    COPY REPORT
                                </button>
                                <button
                                    onClick={() => setShowAnalysisModal(false)}
                                    className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs rounded shadow-lg shadow-cyan-900/20 font-mono transition-all"
                                >
                                    DONE
                                </button>
                            </div>
                            
                            {/* Decorative Grid */}
                             <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-[0]"
                                  style={{
                                      backgroundImage: 'linear-gradient(rgba(34,211,238,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.3) 1px, transparent 1px)',
                                      backgroundSize: '20px 20px'
                                  }}
                             />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Original Audio Player (bottom bar) */}
            <AnimatePresence>
                {loadedFilePath && (
                    <OriginalPlayer
                        key={loadedFilePath}
                        filePath={loadedFilePath}
                        onBassEnergy={setBassEnergy}
                    />
                )}
            </AnimatePresence>

            {/* Footer - shift up when player is showing */}
            <footer className={`absolute text-[10px] text-slate-700 tracking-[0.4em] font-minimal font-bold pointer-events-none uppercase transition-all duration-300 ${loadedFilePath ? 'bottom-[72px]' : 'bottom-6'}`}>
                StemSplit v1.2
            </footer>
        </div>
    );
};

export default ReactorZone;
