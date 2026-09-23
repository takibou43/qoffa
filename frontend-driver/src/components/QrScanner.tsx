import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * مسح QR بالكاميرا الخلفية.
 * يستعمل BarcodeDetector الأصلي إن توفّر (Chrome/Android)، وإلا مكتبة jsQR (تعمل على Safari/iPhone أيضًا).
 */
type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export function isQrScanSupported(): boolean {
  const g = globalThis as unknown as { navigator?: Navigator };
  return !!g.navigator?.mediaDevices?.getUserMedia;
}

export function QrScanner({
  title,
  onDetected,
  onClose,
}: {
  title: string;
  onDetected: (payload: string) => void;
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const Native = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    let detector: InstanceType<DetectorCtor> | null = null;
    try {
      detector = Native ? new Native({ formats: ['qr_code'] }) : null;
    } catch {
      detector = null;
    }

    async function decode(): Promise<string | null> {
      if (detector) {
        const res = await detector.detect(canvas);
        return res[0]?.rawValue ?? null;
      }
      const img = ctx!.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        if (!stopped) setError('تعذّر الوصول إلى الكاميرا. اسمح بالوصول إلى الكاميرا من إعدادات المتصفح.');
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

      const tick = async () => {
        if (stopped) return;
        if (!ctx || video.readyState < 2 || !video.videoWidth) {
          raf = requestAnimationFrame(tick);
          return;
        }
        // تصغير الإطار يسرّع التحليل دون أن يضر بقراءة QR
        const scale = Math.min(1, 720 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const value = await decode();
          if (value && !stopped) {
            onDetectedRef.current(value);
            return; // توقف بعد أول قراءة
          }
        } catch {
          // إطار فاشل عرضيًا
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
        <span className="text-sm font-bold text-white">{title}</span>
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
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-4 border-white/80" />
      </div>
      {error && (
        <div className="space-y-2 bg-black p-4">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-white/15 py-2 text-sm font-medium text-white"
          >
            رجوع
          </button>
        </div>
      )}
    </div>
  );
}
