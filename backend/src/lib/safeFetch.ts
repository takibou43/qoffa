import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { env } from '../config/env.js';

/**
 * طلبات HTTP خارجية آمنة (بلا أي package جديد):
 *  - fetchJson: لواجهات معروفة فقط (allowlist للمضيفين)، مهلة قصيرة، بلا تحويلات (redirects).
 *  - downloadImage: تنزيل صورة من مصدر خارجي مع حماية SSRF حقيقية:
 *      https فقط، المنفذ 443 فقط، رفض أي عنوان IP داخلي/خاص **بعد** حل DNS (والاتصال يتم بنفس العنوان
 *      الذي فُحص — لا ثغرة DNS rebinding)، بلا تحويلات، مهلة، حد أقصى للحجم يُقطع الاتصال عند تجاوزه،
 *      و Content-Type صورة فقط. المستخدم لا يمرّر أي رابط: الروابط تأتي من ردود المصادر الخارجية فقط.
 */

export class ExternalHttpError extends Error {
  constructor(
    message: string,
    public readonly kind: 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'BLOCKED' | 'TOO_LARGE' | 'BAD_TYPE' | 'BAD_JSON',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ExternalHttpError';
  }
}

/* ───────────── عناوين IP الداخلية ───────────── */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** هل العنوان عام على الإنترنت؟ (false لكل ما هو داخلي/محلي/محجوز) */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return !PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === '::' || lower === '::1') return false;
    if (/^f[cd]/.test(lower)) return false; // fc00::/7 (ULA)
    if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 (link-local)
    if (/^ff/.test(lower)) return false; // multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')) return false;
    return true;
  }
  return false;
}

/** DNS lookup يرفض أي عنوان داخلي — يُمرَّر لـhttps.request فيتصل بالعنوان المفحوص نفسه */
function safeLookup(allowLoopback: boolean) {
  return (
    hostname: string,
    options: object,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      // IPv4 أولًا: شبكات كثيرة (منها في الجزائر) تعلن IPv6 دون أن يعمل فعليًا
      const list = [...(addresses as LookupAddress[])].sort((x, y) => x.family - y.family);
      const bad = list.find((a) => !isPublicAddress(a.address) && !(allowLoopback && a.address.startsWith('127.')));
      if (!list.length || bad) {
        const e = new Error('blocked address') as NodeJS.ErrnoException;
        e.code = 'EBLOCKED';
        return callback(e, '', 0);
      }
      if ((options as { all?: boolean }).all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

/* ───────────── JSON من واجهة معروفة ───────────── */

export async function fetchJson<T>(
  url: string,
  opts: { allowedHosts: string[]; timeoutMs: number; headers?: Record<string, string> },
): Promise<{ status: number; body: T | null }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !opts.allowedHosts.includes(u.hostname)) {
    throw new ExternalHttpError('host not allowed', 'BLOCKED');
  }
  let res: Response;
  try {
    res = await fetch(u, {
      headers: { Accept: 'application/json', ...opts.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error).name;
    throw new ExternalHttpError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error',
      name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
    );
  }
  const text = await res.text().catch(() => '');
  if (text.length > 512 * 1024) throw new ExternalHttpError('response too large', 'TOO_LARGE');
  try {
    return { status: res.status, body: text ? (JSON.parse(text) as T) : null };
  } catch {
    throw new ExternalHttpError('invalid json', 'BAD_JSON', res.status);
  }
}

/* ───────────── تنزيل صورة ───────────── */

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  /** إن حُدّد: لا يُقبل إلا هذه المضيفات (مثل images.openfoodfacts.org) */
  allowedHosts?: string[];
  userAgent?: string;
  /** للاختبارات فقط (يُتجاهل خارج NODE_ENV=test): يسمح بخادم http محلي */
  allowLoopbackForTests?: boolean;
}

export function downloadImage(
  url: string,
  opts: DownloadOptions,
): Promise<{ bytes: Buffer; contentType: string }> {
  const testLoopback = env.isTest && opts.allowLoopbackForTests === true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.reject(new ExternalHttpError('bad url', 'BLOCKED'));
  }
  const protocolOk = u.protocol === 'https:' || (testLoopback && u.protocol === 'http:');
  const portOk = u.port === '' || testLoopback;
  if (!protocolOk || !portOk || u.username || u.password) {
    return Promise.reject(new ExternalHttpError('url not allowed', 'BLOCKED'));
  }
  if (opts.allowedHosts && !opts.allowedHosts.includes(u.hostname)) {
    return Promise.reject(new ExternalHttpError('host not allowed', 'BLOCKED'));
  }
  // عنوان IP حرفي في الرابط: يُفحص مباشرة (lookup لا يُستدعى لعناوين IP)
  const literal = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !isPublicAddress(literal) && !(testLoopback && literal.startsWith('127.'))) {
    return Promise.reject(new ExternalHttpError('address not allowed', 'BLOCKED'));
  }

  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup(testLoopback) as never,
        // يجرب كل العناوين المفحوصة (IPv4 ثم IPv6) بدل التعلّق بعنوان واحد لا يستجيب
        ...({ autoSelectFamily: true } as object),
        headers: {
          Accept: 'image/webp,image/jpeg,image/png',
          ...(opts.userAgent ? { 'User-Agent': opts.userAgent } : {}),
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new ExternalHttpError('redirects not followed', 'BLOCKED', status));
        }
        if (status !== 200) {
          res.resume();
          return reject(new ExternalHttpError(`http ${status}`, 'HTTP', status));
        }
        const type = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (!IMAGE_TYPES.has(type)) {
          res.resume();
          return reject(new ExternalHttpError('not an image', 'BAD_TYPE'));
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return reject(new ExternalHttpError('too large', 'TOO_LARGE'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(new ExternalHttpError('too large', 'TOO_LARGE'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (size <= opts.maxBytes) {
            resolve({ bytes: Buffer.concat(chunks), contentType: type === 'image/jpg' ? 'image/jpeg' : type });
          }
        });
        res.on('error', () => reject(new ExternalHttpError('network error', 'NETWORK')));
      },
    );
    // مهلة كلية (لا مهلة خمول فقط): خادم بطيء يرسل بايتًا كل ثانية لا يعلّق الطلب
    const hardTimer = setTimeout(() => {
      req.destroy();
      reject(new ExternalHttpError('timeout', 'TIMEOUT'));
    }, opts.timeoutMs);
    req.on('timeout', () => {
      req.destroy();
      reject(new ExternalHttpError('timeout', 'TIMEOUT'));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new ExternalHttpError(
          err.code === 'EBLOCKED' ? 'address not allowed' : 'network error',
          err.code === 'EBLOCKED' ? 'BLOCKED' : 'NETWORK',
        ),
      );
    });
    req.on('close', () => clearTimeout(hardTimer));
    req.end();
  });
}
