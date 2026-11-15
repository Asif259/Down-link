'use client';

import React, { useRef, useState } from 'react';

interface SpotlightCardProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  spotlightColor?: string;
  className?: string;
  as?: 'div' | 'button';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export default function SpotlightCard({
  children,
  spotlightColor = 'rgba(16, 185, 129, 0.18)',
  className = '',
  as = 'div',
  disabled = false,
  type = 'button',
  ...props
}: SpotlightCardProps) {
  const containerRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const Component = as as React.ElementType;

  return (
    <Component
      ref={containerRef}
      type={as === 'button' ? type : undefined}
      disabled={as === 'button' ? disabled : undefined}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl transition-colors duration-300 hover:border-white/20 text-left ${className}`}
      {...props}
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-500"
        style={{
          opacity,
          background: `radial-gradient(380px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 70%)`,
        }}
      />
      <div className="relative z-10 w-full">{children}</div>
    </Component>
  );
}
