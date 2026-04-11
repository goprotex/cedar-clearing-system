'use client';

import { motion, useReducedMotion } from 'motion/react';

export function HeroBackdrop() {
  const reduce = useReducedMotion();

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* Soft grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 107, 0, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 107, 0, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 80% 70% at 70% 40%, black 20%, transparent 70%)',
        }}
      />
      {/* Animated orbs */}
      {!reduce && (
        <>
          <motion.div
            className="absolute -top-[20%] right-[5%] w-[min(90vw,520px)] h-[min(90vw,520px)] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(255, 107, 0, 0.22) 0%, transparent 65%)',
              filter: 'blur(40px)',
            }}
            animate={{
              scale: [1, 1.08, 1],
              opacity: [0.5, 0.75, 0.5],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <motion.div
            className="absolute bottom-[10%] right-[25%] w-[280px] h-[280px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(19, 255, 67, 0.12) 0%, transparent 70%)',
              filter: 'blur(32px)',
            }}
            animate={{
              x: [0, 24, 0],
              y: [0, -16, 0],
            }}
            transition={{
              duration: 14,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </>
      )}
      {/* Horizontal scan pulse */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[120%] opacity-[0.12]"
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(255, 107, 0, 0.15) 50%, transparent 100%)',
        }}
        animate={
          reduce
            ? undefined
            : {
                y: ['-20%', '120%'],
              }
        }
        transition={{
          duration: reduce ? 0 : 9,
          repeat: reduce ? 0 : Infinity,
          ease: 'linear',
        }}
      />
    </div>
  );
}
