'use client';

import React from 'react';

interface StarBorderProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

export default function StarBorder({
  children,
  color = '#10b981',
  className = '',
}: StarBorderProps) {
  return (
    <div className={`relative p-[1.5px] overflow-hidden rounded-2xl group ${className}`}>
      <div
        className="pointer-events-none absolute inset-0 opacity-75 transition-opacity duration-500 group-focus-within:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${color}66, transparent 70%)`,
        }}
      />
      <div
        className="pointer-events-none absolute -inset-[100%] animate-[spin_6s_linear_infinite] motion-reduce:animate-none opacity-40 group-focus-within:opacity-90 transition-opacity transform-gpu will-change-transform"
        style={{
          background: `conic-gradient(from 0deg, transparent 0 300deg, ${color} 360deg)`,
        }}
      />
      <div className="relative z-10 rounded-[15px] bg-zinc-950/95 backdrop-blur-2xl">
        {children}
      </div>
    </div>
  );
}
