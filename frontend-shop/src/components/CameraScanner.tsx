import { useEffect, useRef, useState } from 'react';

/**
 * مسح الباركود بالكاميرا عبر واجهة المتصفح الأصلية BarcodeDetector — بلا أي مكتبة خارجية.
 * مدعومة حاليًا في Chrome/Edge على الجوال وسطح المكتب؛ في المتصفحات الأخرى نُخفي الزر
 * ونترك الإدخال اليدوي أو قارئ الباركود الخارجي (الذي يعمل عبر لوحة المفاتيح أصلًا).
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/**
 * لا تعتمد على `window` مباشرة (كي تبقى قابلة للاختبار خارج بيئة DOM) بل على `globalThis`،
 * الذي يساويه في المتصفح فعليًا.
 */
export function isCameraScanSupported(): boolean {
  const g = globalThis as unknown as { BarcodeDetector?: unknown; navigator?: Navigator };
  return typeof g.BarcodeDetector !== 'undefined' && !!g.navigator?.mediaDevices?.getUserMedia;
}

export function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        if (!stopped) setError('تعذّر الوصول إلى الكاميرا. تحقّق من الأذونات أو استعمل الإدخال اليدوي.');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const Ctor = (globalThis as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
      const detector = new Ctor({ formats: FORMATS });

      const tick = async () => {
        if (stopped || !video || video.readyState < 2 || !ctx) {
          raf = requestAnimationFrame(tick);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const results = await detector.detect(canvas);
          const code = results[0]?.rawValue;
          if (code) {
            onDetectedRef.current(code);
            return; // توقف عن المسح بعد أول نتيجة
          }
        } catch {
          // إطار فاشل عرضيًا — يُتجاهل ونحاول الإطار التالي
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-bold text-white">وجّه الكاميرا نحو الباركود</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white"
        >
          إغلاق
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="size-full object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-2xl border-2 border-white/80" />
      </div>

      {error && (
        <div className="space-y-2 bg-black p-4">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-white/15 py-2 text-sm font-medium text-white"
          >
            إدخال الباركود يدويًا
          </button>
        </div>
      )}
    </div>
  );
}
