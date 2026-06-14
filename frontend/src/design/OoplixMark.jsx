import React from 'react';

/**
 * OoplixMark — The OVERRIDE symbol.
 * Two bars. Thick (authority) over thin (displaced).
 * Thin bar right-aligned — pushed left by the override.
 *
 * Usage:
 *   <OoplixMark size={32} />
 *   <OoplixMark size={48} bg="transparent" fg="#6657e8" />
 */
export function OoplixMark({ size = 32, bg = '#03050a', fg = '#ffffff', rx, className, style }) {
  const borderRadius = rx ?? Math.round(size * 0.15625); // ~5/32 ratio
  const pad = size * 0.125; // 12.5% padding
  const inner = size - pad * 2;

  // Thick bar: full inner width, 19% of inner height
  const thickH = Math.round(inner * 0.19);
  const thickY = pad + Math.round(inner * 0.27); // sits at ~27% from top of inner box
  const thickX = pad;
  const thickW = inner;

  // Gap: 28% of thick bar height between bottom of thick and top of thin
  const gap = Math.round(thickH * 0.28);

  // Thin bar: 72% of inner width, right-aligned, half the height of thick
  const thinH = Math.round(thickH * 0.5);
  const thinW = Math.round(inner * 0.72);
  const thinY = thickY + thickH + gap;
  const thinX = pad + inner - thinW; // right-aligned

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label="Ooplix"
    >
      {bg !== 'transparent' && (
        <rect width={size} height={size} rx={borderRadius} fill={bg} />
      )}
      <rect x={thickX} y={thickY} width={thickW} height={thickH} rx={1} fill={fg} />
      <rect x={thinX} y={thinY} width={thinW} height={thinH} rx={1} fill={fg} />
    </svg>
  );
}

export default OoplixMark;
