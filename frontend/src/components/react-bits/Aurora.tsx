'use client';

import React, { useEffect, useRef } from 'react';

interface AuroraProps {
  colorStops?: [string, string, string];
  speed?: number;
  amplitude?: number;
  className?: string;
}

export default function Aurora({
  colorStops = ['#10b981', '#06b6d4', '#6366f1'],
  speed = 0.6,
  amplitude = 1.1,
  className = '',
}: AuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      time += 0.008 * speed;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'screen';

      colorStops.forEach((color, index) => {
        const offset = (index * Math.PI * 2) / colorStops.length;
        const x =
          width * (0.25 + 0.25 * index) +
          Math.sin(time + offset) * (width * 0.18 * amplitude);
        const y =
          height * 0.32 +
          Math.cos(time * 0.8 + offset) * (height * 0.15 * amplitude);
        const radius = Math.max(width, height) * 0.48;

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `${color}55`);
        gradient.addColorStop(0.5, `${color}22`);
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [colorStops, speed, amplitude]);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full opacity-90 blur-3xl saturate-150 transition-all duration-1000"
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_20%,#030712_85%)]" />
    </div>
  );
}
