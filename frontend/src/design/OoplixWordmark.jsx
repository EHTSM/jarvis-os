import React from 'react';
import { OoplixMark } from './OoplixMark';

/**
 * OoplixWordmark — Mark + "Ooplix" text side by side.
 * Use in nav headers, auth screens, and brand moments.
 *
 * Usage:
 *   <OoplixWordmark size={28} />            // follows the active theme
 *   <OoplixWordmark size={20} dark={false} />  // force dark-on-light
 *   <OoplixWordmark size={20} dark />          // force light-on-dark
 *
 * B19.2.2: `dark` used to default to `true`, painting rgba(255,255,255,0.96)
 * even in light mode — 1.09:1 against the light canvas. It now defaults to
 * `undefined`, meaning "follow the theme" via --text, and only pins a literal
 * when a caller explicitly opts in (e.g. over a fixed dark brand panel).
 */
export function OoplixWordmark({ size = 28, className, style, dark }) {
  const textColor =
    dark === undefined ? 'var(--text)' : dark ? 'rgba(255,255,255,0.96)' : '#03050a';
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
