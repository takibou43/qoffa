import { describe, expect, it } from 'vitest';
import { orderItemImage } from '../src/lib/images';

describe('صورة سطر الطلب', () => {
  it('تعرض صورة المنتج العالمي الحالية', () => {
    expect(orderItemImage({ product: { product: { imageUrl: 'https://x/p.webp' } } })).toBe('https://x/p.webp');
  });

  it('بديل (null) إن حُذفت الصورة أو حُذف المنتج من المحل أو كان طلبًا قديمًا بلا الحقل', () => {
    expect(orderItemImage({ product: { product: { imageUrl: null } } })).toBeNull();
    expect(orderItemImage({ product: null })).toBeNull();
    expect(orderItemImage({})).toBeNull();
  });
});
