import { useLayoutEffect } from 'react';

export function useForcedDarkTheme() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.add('dark');

    return () => {
      html.classList.toggle('dark', wasDark);
    };
  }, []);
}
