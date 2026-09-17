import { useCallback, useEffect, useState } from 'react';

export interface Coords {
  lat: number;
  lon: number;
}

const STORAGE_KEY = 'qoffa.location';

/**
 * الموقع اختياري تمامًا.
 * إذا رفض المستخدم الإذن يواصل استعمال التطبيق ويُدخل عنوانه يدويًا.
 */
export function useLocation() {
  const [coords, setCoords] = useState<Coords | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Coords) : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'granted' | 'denied' | 'unsupported'>(
    'idle',
  );

  useEffect(() => {
    if (coords) setStatus('granted');
  }, [coords]);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setCoords(next);
        setStatus('granted');
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // تجاهل
        }
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setStatus('idle');
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { coords, status, request, clear };
}
