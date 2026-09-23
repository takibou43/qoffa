import { describe, expect, it } from 'vitest';
import { lookupNotice } from '../src/lib/barcodeLookup';
import type { GlobalProduct } from '../src/lib/types';

const product = (imageUrl: string | null): GlobalProduct => ({
  id: 'p1', barcode: '6131234567890', name: 'Coca-Cola 1L', brand: 'Coca-Cola', description: null,
  imageUrl, unit: '1L', categoryId: null, category: null,
});

describe('رسائل البحث بالباركود', () => {
  it('الحالة 1: موجود في قُفّة', () => {
    const m = lookupNotice({ status: 'AVAILABLE_TO_ADD', product: product('https://x/p.webp'), lookup: { source: 'QOFFA', createdFromExternal: false, imageFound: true } });
    expect(m).toContain('تم العثور على المنتج في قُفّة');
    expect(m).not.toContain('لم نجد صورة');
  });

  it('الحالة 2: من المصدر الخارجي وحُفظ في قُفّة', () => {
    const m = lookupNotice({ status: 'AVAILABLE_TO_ADD', product: product('https://x/p.webp'), lookup: { source: 'OPEN_FOOD_FACTS', createdFromExternal: true, imageFound: true } });
    expect(m).toContain('تم العثور على المنتج من المصدر الخارجي (Open Food Facts)');
    expect(m).toContain('تم حفظه في قُفّة');
  });

  it('من المصدر الخارجي بلا صورة → دعوة لرفع صورة', () => {
    const m = lookupNotice({ status: 'AVAILABLE_TO_ADD', product: product(null), lookup: { source: 'UPCITEMDB', createdFromExternal: true, imageFound: false } });
    expect(m).toContain('UPCitemdb');
    expect(m).toContain('لم نجد صورة لهذا المنتج');
  });

  it('الحالة 3: غير موجود / المصادر غير متاحة', () => {
    expect(lookupNotice({ status: 'NEW', barcode: '1', lookup: { source: 'MANUAL', externalTried: true, externalUnavailable: false } })).toContain('لم يتم العثور على المنتج');
    expect(lookupNotice({ status: 'NEW', barcode: '1', lookup: { source: 'MANUAL', externalTried: true, externalUnavailable: true } })).toBe(
      'لم نجد بيانات تلقائية لهذا الباركود. يمكنك إدخال بيانات المنتج ورفع الصورة يدويًا.',
    );
  });

  it('ردود قديمة بلا lookup تبقى تعمل', () => {
    expect(lookupNotice({ status: 'NEW', barcode: '1' })).toContain('لم يتم العثور');
    expect(lookupNotice({ status: 'AVAILABLE_TO_ADD', product: product(null) })).toContain('في قُفّة');
  });
});
