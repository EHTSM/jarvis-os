import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

/**
 * useVirtualList — window-based virtual list rendering.
 *
 * Renders only the rows visible in the scroll container plus an overscan
 * buffer. Zero dependencies beyond React itself.
 *
 * @param {object} opts
 * @param {number}   opts.itemCount      — total number of items
 * @param {number}   opts.itemHeight     — fixed row height in px
 * @param {number}   [opts.overscan=5]   — rows to render beyond the viewport edge
 * @param {number}   [opts.containerHeight] — explicit container height (px); auto if omitted
 *
 * @returns {{
 *   containerRef: React.Ref,
 *   outerStyle:   React.CSSProperties,  // apply to scroll container
 *   innerStyle:   React.CSSProperties,  // apply to inner absolute-positioned div
 *   virtualItems: { index: number, top: number }[],
 * }}
 */
export function useVirtualList({ itemCount, itemHeight, overscan = 5, containerHeight: forcedHeight }) {
  const containerRef  = useRef(null);
  const [scrollTop,   setScrollTop]   = useState(0);
  const [viewHeight,  setViewHeight]  = useState(forcedHeight || 400);

  // Track scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Track resize
  useEffect(() => {
    if (forcedHeight) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setViewHeight(entry.contentRect.height || 400);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [forcedHeight]);

  const totalHeight = itemCount * itemHeight;

  const virtualItems = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end   = Math.min(itemCount - 1, Math.ceil((scrollTop + viewHeight) / itemHeight) + overscan);
    const items = [];
    for (let i = start; i <= end; i++) {
      items.push({ index: i, top: i * itemHeight });
    }
    return items;
  }, [scrollTop, viewHeight, itemCount, itemHeight, overscan]);

  const outerStyle = useMemo(() => ({
    overflowY: 'auto',
    height: forcedHeight ? forcedHeight : '100%',
    position: 'relative',
  }), [forcedHeight]);

  const innerStyle = useMemo(() => ({
    height: totalHeight,
    position: 'relative',
  }), [totalHeight]);

  return { containerRef, outerStyle, innerStyle, virtualItems };
}

/**
 * VirtualRow — absolutely positioned wrapper for a virtual row.
 * Usage:
 *   {virtualItems.map(item => (
 *     <VirtualRow key={item.index} top={item.top} height={itemHeight}>
 *       <MyRow data={data[item.index]} />
 *     </VirtualRow>
 *   ))}
 */
export function VirtualRow({ top, height, children, style }) {
  return (
    <div style={{ position: 'absolute', top, height, width: '100%', ...style }}>
      {children}
    </div>
  );
}
