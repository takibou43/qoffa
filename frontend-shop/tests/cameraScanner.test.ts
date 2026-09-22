import { afterEach, describe, expect, it } from 'vitest';
import { isCameraScanSupported } from '../src/components/CameraScanner';

const g = globalThis as unknown as { BarcodeDetector?: unknown };

/** navigator العام في Node للقراءة فقط (getter)؛ نعرّفه من جديد قابلًا لإعادة التعريف للاختبار فقط */
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
}

describe('دعم مسح الباركود بالكاميرا', () => {
  afterEach(() => {
    delete g.BarcodeDetector;
  });

  it('غير مدعوم إن لم تتوفر BarcodeDetector', () => {
    setNavigator({ mediaDevices: { getUserMedia: () => Promise.resolve() } });
    expect(isCameraScanSupported()).toBe(false);
  });

  it('غير مدعوم إن لم تتوفر الكاميرا (getUserMedia)', () => {
    g.BarcodeDetector = class {};
    setNavigator({});
    expect(isCameraScanSupported()).toBe(false);
  });

  it('مدعوم عند توفر الاثنين معًا', () => {
    g.BarcodeDetector = class {};
    setNavigator({ mediaDevices: { getUserMedia: () => Promise.resolve() } });
    expect(isCameraScanSupported()).toBe(true);
  });
});
