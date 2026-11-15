'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface BlurTextProps {
  text: string;
  delay?: number;
  className?: string;
}

export default function BlurText({
  text,
  delay = 0.06,
  className = '',
}: BlurTextProps) {
  const words = text.split(' ');

  return (
    <h1 className={`flex flex-wrap justify-center gap-y-1 ${className}`}>
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          initial={{ filter: 'blur(12px)', opacity: 0, y: 18 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: index * delay,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="inline-block will-change-[transform,filter,opacity] mr-2 sm:mr-3 last:mr-0"
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
}
