'use client';

import React from 'react';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

export default function ShinyText({
  text,
  disabled = false,
  speed = 3,
  className = '',
}: ShinyTextProps) {
  return (
    <span
      style={{
        backgroundImage:
          'linear-gradient(120deg, rgba(255,255,255,0.55) 35%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.55) 65%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        animationDuration: `${speed}s`,
      }}
      className={`inline-block bg-clip-text text-transparent ${
        disabled ? '' : 'animate-[shimmer_3s_infinite_linear]'
      } ${className}`}
    >
      {text}
    </span>
  );
}
