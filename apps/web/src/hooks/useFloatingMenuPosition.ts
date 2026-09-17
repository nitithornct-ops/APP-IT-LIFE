import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 256;

/**
 * Positions a menu at the document root so it can escape scrolling/overflowing
 * parents such as modal content and data-table frames.
 */
export function useFloatingMenuPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties | null {
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - VIEWPORT_GUTTER;
      const availableAbove = rect.top - VIEWPORT_GUTTER;
      const opensAbove = availableBelow < 180 && availableAbove > availableBelow;
      const availableHeight = Math.max(96, Math.min(MENU_MAX_HEIGHT, opensAbove ? availableAbove : availableBelow));
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, rect.left),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - rect.width - VIEWPORT_GUTTER),
      );

      setPosition({
        left,
        width: rect.width,
        maxHeight: availableHeight,
        ...(opensAbove
          ? { bottom: Math.max(VIEWPORT_GUTTER, window.innerHeight - rect.top + MENU_GAP) }
          : { top: Math.min(window.innerHeight - VIEWPORT_GUTTER - availableHeight, rect.bottom + MENU_GAP) }),
      });
    };

    update();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, open]);

  return position;
}
