import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from '../src/lib/dbConfig.js';

describe('parseDatabaseUrl', () => {
  it('يحلل رابطًا عاديًا', () => {
    const c = parseDatabaseUrl('postgresql://u.ref:pa55@db.example.com:6543/postgres?sslmode=require');
    expect(c).toMatchObject({ user: 'u.ref', password: 'pa55', host: 'db.example.com', port: 6543, database: 'postgres' });
    expect(c.params.get('sslmode')).toBe('require');
  });

  it('يتحمل كلمة مرور فيها رموز خاصة غير مرمَّزة', () => {
    const c = parseDatabaseUrl('postgresql://u.ref:p@s#s/w?rd%:x@db.example.com:6543/postgres');
    expect(c).toMatchObject({ user: 'u.ref', password: 'p@s#s/w?rd%:x', host: 'db.example.com', port: 6543 });
  });

  it('يفك ترميز كلمة المرور المرمَّزة ويزيل علامات الاقتباس والمسافات', () => {
    const c = parseDatabaseUrl('  "postgres://u:a%40b@h:5432/db?schema=public"  ');
    expect(c).toMatchObject({ user: 'u', password: 'a@b', host: 'h', port: 5432, database: 'db' });
    expect(c.params.get('schema')).toBe('public');
  });

  it('يرفض القيمة غير الصالحة دون كشفها', () => {
    const secret = 'onlyAPasswordValue';
    expect(() => parseDatabaseUrl(secret)).toThrow(/الشكل/);
    try {
      parseDatabaseUrl(secret);
    } catch (e) {
      expect(String(e)).not.toContain(secret);
    }
  });
});
