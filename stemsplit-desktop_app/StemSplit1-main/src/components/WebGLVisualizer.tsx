// src/components/WebGLVisualizer.tsx
import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

// Generate random points in a sphere shape
function generateSpherePoints(count: number, radius: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = THREE.MathUtils.randFloatSpread(360); 
    const phi = THREE.MathUtils.randFloatSpread(360);

    const x = radius * Math.sin(theta) * Math.cos(phi);
    const y = radius * Math.sin(theta) * Math.sin(phi);
    const z = radius * Math.cos(theta);

    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z;
  }
  return points;
}

const ParticleSphere: React.FC<{ isProcessing: boolean }> = ({ isProcessing }) => {
  const ref = useRef<THREE.Points>(null!);
  const [sphere] = useState(() => generateSpherePoints(5000, 1.2));

  useFrame((state, delta) => {
    if (!ref.current) return;
    
    // Rotate constantly
    ref.current.rotation.x -= delta / 10;
    ref.current.rotation.y -= delta / 15;

    // Pulse/Expand if processing
    if (isProcessing) {
      const time = state.clock.getElapsedTime();
      const scale = 1 + Math.sin(time * 10) * 0.1; // Fast pulse
      ref.current.scale.set(scale, scale, scale);
      // Change color or intensity via material if needed, but easier to handle via props
    } else {
        ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }
  });

  return (
    <group rotation={[0, 0, Math.PI / 4]}>
      <Points ref={ref} positions={sphere} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color={isProcessing ? "#22d3ee" : "#0f172a"} // Cyan vs Dark Blue
          size={0.02}
          sizeAttenuation={true}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </Points>
    </group>
  );
};

export const WebGLVisualizer: React.FC<{ isProcessing: boolean }> = ({ isProcessing }) => {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none opacity-60">
      <Canvas camera={{ position: [0, 0, 3] }}>
        <ParticleSphere isProcessing={isProcessing} />
      </Canvas>
    </div>
  );
};
