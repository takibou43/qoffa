import { describe, expect, it } from 'vitest';
import { computeIsOpenNow, isWithinWorkingHours } from '../src/lib/hours.js';

const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m, 0);

describe('ساعات العمل', () => {
  it('فترة عادية داخل اليوم', () => {
    expect(isWithinWorkingHours('08:00', '22:00', at(12))).toBe(true);
    expect(isWithinWorkingHours('08:00', '22:00', at(7, 59))).toBe(false);
    expect(isWithinWorkingHours('08:00', '22:00', at(22))).toBe(false);
    expect(isWithinWorkingHours('08:00', '22:00', at(21, 59))).toBe(true);
  });

  it('فترة تعبر منتصف الليل', () => {
    expect(isWithinWorkingHours('22:00', '02:00', at(23))).toBe(true);
    expect(isWithinWorkingHours('22:00', '02:00', at(1))).toBe(true);
    expect(isWithinWorkingHours('22:00', '02:00', at(3))).toBe(false);
    expect(isWithinWorkingHours('22:00', '02:00', at(12))).toBe(false);
  });

  it('مفتوح 24 ساعة عندما يتساوى الوقتان', () => {
    expect(isWithinWorkingHours('00:00', '00:00', at(5))).toBe(true);
  });

  it('صيغة غير صالحة لا تمنع الخدمة', () => {
    expect(isWithinWorkingHours('abc', '22:00', at(12))).toBe(true);
    expect(isWithinWorkingHours('25:00', '22:00', at(12))).toBe(true);
  });

  it('isOpenNow يتطلب مفتاح المالك وساعات العمل معًا', () => {
    expect(computeIsOpenNow({ isOpen: false, openingTime: '00:00', closingTime: '00:00' })).toBe(
      false,
    );
    expect(computeIsOpenNow({ isOpen: true, openingTime: '00:00', closingTime: '00:00' })).toBe(
      true,
    );
  });
});
