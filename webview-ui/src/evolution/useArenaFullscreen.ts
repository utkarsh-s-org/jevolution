import { type RefObject, useEffect, useState } from 'react';

export function useArenaFullscreen(element: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<'none' | 'native' | 'expanded'>('none');
  useEffect(() => {
    const changed = () =>
      setMode((current) =>
        document.fullscreenElement === element.current
          ? 'native'
          : current === 'expanded'
            ? current
            : 'none',
      );
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [element]);
  useEffect(() => {
    if (mode === 'none') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mode === 'expanded') setMode('none');
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [mode]);
  return {
    active: mode !== 'none',
    toggle: async () => {
      if (mode !== 'none') {
        if (document.fullscreenElement === element.current) await document.exitFullscreen();
        setMode('none');
      } else {
        try {
          if (!element.current?.requestFullscreen) throw new Error('Fullscreen unavailable');
          await element.current.requestFullscreen();
          setMode('native');
        } catch {
          setMode('expanded');
        }
      }
    },
  };
}
