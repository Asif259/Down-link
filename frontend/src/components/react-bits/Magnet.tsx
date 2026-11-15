'use client';

import React, { useRef, useState } from 'react';

interface MagnetProps {
  children: React.ReactNode;
  strength?: number;
  disabled?: boolean;
  className?: string;
}

export default function Magnet({
  children,
  strength = 0.22,
  disabled = false,
  className = '',
}: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setOffset({
      x: (e.clientX - centerX) * strength,
      y: (e.clientY - centerY) * strength,
    });
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setOffset({ x: 0, y: 0 })}
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        transition:
          offset.x === 0
            ? 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'transform 0.1s ease-out',
      }}
      className={className}
    >
      {children}
    </div>
  );
}
