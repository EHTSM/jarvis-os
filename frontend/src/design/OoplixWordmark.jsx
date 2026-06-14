import React from 'react';
import { OoplixMark } from './OoplixMark';

/**
 * OoplixWordmark — Mark + "Ooplix" text side by side.
 * Use in nav headers, auth screens, and brand moments.
 *
 * Usage:
 *   <OoplixWordmark size={28} />
 *   <OoplixWordmark size={20} dark={false} />
 */
export function OoplixWordmark({ size = 28, className, style, dark = true }) {
  const textColor = dark ? 'rgba(255,255,255,0.96)' : '#03050a';
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.35),
        ...style,
      }}
    >
      <OoplixMark size={size} />
      <span style={{
        fontFamily: '"Inter", "Geist", -apple-system, sans-serif',
        fontSize: Math.round(size * 0.57),
        fontWeight: 700,
        letterSpacing: '-0.025em',
        color: textColor,
        lineHeight: 1,
      }}>
        Ooplix
      </span>
    </span>
  );
}

export default OoplixWordmark;
