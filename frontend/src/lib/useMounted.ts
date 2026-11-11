'use client';

import { useEffect, useState } from 'react';

/**
 * A mount gate for components that read persisted client state (zustand,
 * localStorage) during render. The server renders with the defaults, the
 * first client render does the same, and only after mounting does the
 * persisted value appear — so React never sees a hydration mismatch or a
 * flash of the wrong content.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
