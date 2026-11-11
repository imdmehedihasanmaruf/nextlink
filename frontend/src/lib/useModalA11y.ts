'use client';

import { useEffect } from 'react';

/**
 * Close an overlay with the Escape key and keep the page from scrolling
 * while it is open. Every modal in the portal uses this hook so a dialog can
 * always be dismissed with the keyboard.
 */
export function useModalA11y(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [active, onClose]);
}
