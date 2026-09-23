import { describe, expect, it } from 'vitest';
import {
  ACCEPT_ATTR,
  MAX_PICKED_BYTES,
  checkPickedFile,
  fitWithin,
} from '../src/lib/imageUpload';

describe('تجهيز صورة المنتج قبل الرفع', () => {
  it('يصغّر الصور الكبيرة مع الحفاظ على النسبة', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 576, height: 1024 });
  });

  it('لا يكبّر الصور الصغيرة', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('يقبل JPEG / PNG / WebP فقط', () => {
    expect(checkPickedFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(checkPickedFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkPickedFile({ type: 'image/webp', size: 1000 })).toBeNull();
    for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', '']) {
      expect(checkPickedFile({ type, size: 1000 })).not.toBeNull();
    }
    expect(ACCEPT_ATTR).toBe('image/jpeg,image/png,image/webp');
  });

  it('يرفض الملفات الضخمة قبل الضغط', () => {
    expect(checkPickedFile({ type: 'image/jpeg', size: MAX_PICKED_BYTES + 1 })).toMatch(/كبير/);
  });
});
