import type { PoolConfig } from 'pg';

/**
 * يحوّل DATABASE_URL إلى إعداد pg مع تحمّل كلمات المرور التي تحوي رموزًا خاصة غير مُرمَّزة
 * (@ # / ? % :) — وهو خطأ شائع عند لصق الرابط يدويًا في لوحات الاستضافة.
 * لا يطبع القيمة أبدًا؛ عند الفشل يصف الشكل فقط.
 */
const URL_RE = /^(postgres(?:ql)?):\/\/([^:/@]+)(?::(.*))?@([^@/?#:]+)(?::(\d+))?\/([^?#]*)(?:\?(.*))?$/s;

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v; // رموز % غير صالحة → القيمة كما هي
  }
}

export function describeShape(raw: string): string {
  return JSON.stringify({
    length: raw.length,
    scheme: /^postgres(ql)?:\/\//.test(raw),
    atSigns: (raw.match(/@/g) ?? []).length,
    hasPort: /:\d+\//.test(raw),
    hasWhitespace: /\s/.test(raw),
    quoted: /^["']|["']$/.test(raw),
  });
}

export function parseDatabaseUrl(input: string): PoolConfig & { params: URLSearchParams } {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  const m = URL_RE.exec(raw);
  if (!m) {
    throw new Error(`DATABASE_URL بصيغة غير صالحة (الشكل: ${describeShape(raw)})`);
  }
  const [, , user, password, host, port, database, query] = m;
  return {
    user: safeDecode(user ?? ''),
    password: password === undefined ? undefined : safeDecode(password),
    host: host ?? '',
    port: port ? Number(port) : 5432,
    database: safeDecode(database || 'postgres'),
    params: new URLSearchParams(query ?? ''),
  };
}
