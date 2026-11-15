'use client';

import React, { useRef } from 'react';

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
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);

  const handleMouseEnter = () => {
    if (containerRef.current) {
      rectRef.current = containerRef.current.getBoundingClientRect();
    }
    if (spotlightRef.current) {
      spotlightRef.current.style.opacity = '1';
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!spotlightRef.current) return;
    if (!rectRef.current && containerRef.current) {
      rectRef.current = containerRef.current.getBoundingClientRect();
    }
    const rect = rectRef.current;
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    spotlightRef.current.style.background = `radial-gradient(380px circle at ${x}px ${y}px, ${spotlightColor}, transparent 70%)`;
  };

  const handleMouseLeave = () => {
    rectRef.current = null;
    if (spotlightRef.current) {
      spotlightRef.current.style.opacity = '0';
    }
  };

  const Component = as as React.ElementType;

  return (
    <Component
      ref={containerRef}
      type={as === 'button' ? type : undefined}
      disabled={as === 'button' ? disabled : undefined}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl transition-colors duration-300 hover:border-white/20 text-left [contain:paint] ${className}`}
      {...props}
    >
      <div
        ref={spotlightRef}
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300"
      />
      <div className="relative z-10 w-full">{children}</div>
    </Component>
  );
}
