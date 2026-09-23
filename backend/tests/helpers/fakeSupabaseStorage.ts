import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * خادم محلي يحاكي واجهة Supabase Storage REST (رفع/حذف/قراءة عامة) — للاختبارات وE2E المحلي فقط.
 * يرفض أي طلب كتابة بلا المفتاح الصحيح، ويرفض الكتابة فوق ملف موجود (x-upsert: false) كما يفعل Supabase.
 */
export async function startFakeSupabaseStorage(key: string, bucket = 'product-images', port = 0) {
  const files = new Map<string, { bytes: Buffer; type: string }>();
  const requests: { method: string; url: string; apikey?: string; auth?: string }[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
      requests.push({
        method: req.method ?? '',
        url,
        apikey: req.headers.apikey as string | undefined,
        auth: req.headers.authorization,
      });
      const send = (status: number, payload: unknown, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
        res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
      };

      const publicPrefix = `/storage/v1/object/public/${bucket}/`;
      if (req.method === 'GET' && url.startsWith(publicPrefix)) {
        const f = files.get(url.slice(publicPrefix.length));
        return f ? send(200, f.bytes, f.type) : send(404, { error: 'not_found' });
      }

      if (req.headers.apikey !== key) return send(401, { error: 'Unauthorized' });

      const objectPrefix = `/storage/v1/object/${bucket}/`;
      if (req.method === 'POST' && url.startsWith(objectPrefix)) {
        const path = url.slice(objectPrefix.length);
        if (files.has(path) && req.headers['x-upsert'] !== 'true') return send(409, { error: 'Duplicate' });
        files.set(path, { bytes: body, type: String(req.headers['content-type']) });
        return send(200, { Key: `${bucket}/${path}` });
      }
      if (req.method === 'DELETE' && url === `/storage/v1/object/${bucket}`) {
        const { prefixes } = JSON.parse(body.toString() || '{}') as { prefixes?: string[] };
        for (const p of prefixes ?? []) files.delete(p);
        return send(200, (prefixes ?? []).map((name) => ({ name })));
      }
      return send(400, { error: 'unsupported' });
    });
  });

  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: actualPort } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    files,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
