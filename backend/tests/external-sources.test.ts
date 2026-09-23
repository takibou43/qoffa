import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadImage, isPublicAddress } from '../src/lib/safeFetch.js';
import {
  isExternalLookupCandidate,
  lookupOpenFoodFacts,
  lookupUpcItemDb,
  offFrontImages,
  pickBrand,
  sameGtin,
} from '../src/services/externalCatalog.js';
import { makePng } from './helpers/images.js';

/** شكل ردود حقيقية (مأخوذ من Open Food Facts و UPCitemdb، مختصر) */
const OFF_COKE = {
  code: '5449000054227',
  status: 1,
  product: {
    code: '5449000054227',
    product_name: 'Coca-Cola Original Taste',
    product_name_fr: '',
    brands: 'COCA-COLA SERVICES SA/NV, Coca-Cola',
    quantity: '1 L',
    image_front_url: 'https://images.openfoodfacts.org/images/products/544/900/005/4227/front_en.563.400.jpg',
    selected_images: {
      front: {
        display: {
          en: 'https://images.openfoodfacts.org/images/products/544/900/005/4227/front_en.563.400.jpg',
          fr: 'https://images.openfoodfacts.org/images/products/544/900/005/4227/front_fr.564.400.jpg',
        },
      },
    },
  },
};

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Open Food Facts', () => {
  it('يستخرج الاسم والعلامة والحجم وصورة الواجهة فقط، ويطلب الحقول اللازمة فقط بـUser-Agent مخصّص', async () => {
    const spy = mockFetch(200, OFF_COKE);
    const r = await lookupOpenFoodFacts('5449000054227');
    expect(r).toEqual({
      kind: 'FOUND',
      product: {
        source: 'OPEN_FOOD_FACTS',
        name: 'Coca-Cola Original Taste',
        brand: 'Coca-Cola',
        quantity: '1 L',
        imageCandidates: [
          OFF_COKE.product.selected_images.front.display.fr,
          OFF_COKE.product.selected_images.front.display.en,
        ],
      },
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/5449000054227\?fields=/);
    expect((init as RequestInit).redirect).toBe('error');
    expect(((init as RequestInit).headers as Record<string, string>)['User-Agent']).toMatch(/^Qoffa\//);
  });

  it('غير موجود (status 0 أو 404) → NOT_FOUND', async () => {
    mockFetch(404, { status: 0, status_verbose: 'product not found' });
    expect(await lookupOpenFoodFacts('6130000000000')).toEqual({ kind: 'NOT_FOUND' });
  });

  it('باركود مختلف في الرد → نرفض النتيجة', async () => {
    mockFetch(200, { ...OFF_COKE, code: '5449000000000', product: { ...OFF_COKE.product, code: '5449000000000' } });
    expect(await lookupOpenFoodFacts('5449000054227')).toEqual({ kind: 'NOT_FOUND' });
  });

  it('لا يستعمل صورة المكونات أو التغذية ولا مضيفًا آخر', () => {
    expect(
      offFrontImages({
        image_front_url: 'https://evil.example/front_fr.jpg',
        selected_images: {
          front: {
            display: {
              fr: 'https://images.openfoodfacts.org/images/products/1/ingredients_fr.3.400.jpg',
              en: 'http://images.openfoodfacts.org/images/products/1/front_en.3.400.jpg',
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it('حد الاستعمال / timeout / JSON تالف → ERROR (لا استثناء)', async () => {
    mockFetch(429, 'Too many');
    expect((await lookupOpenFoodFacts('5449000054227')).kind).toBe('ERROR');
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    expect(await lookupOpenFoodFacts('5449000054227')).toEqual({ kind: 'ERROR', reason: 'TIMEOUT' });
    vi.restoreAllMocks();
    mockFetch(200, '<html>');
    expect((await lookupOpenFoodFacts('5449000054227')).kind).toBe('ERROR');
  });
});

describe('UPCitemdb', () => {
  it('الخطة التجريبية بلا مفتاح، يطابق ean ويأخذ روابط https فقط، ويتجاهل الأسعار', async () => {
    const spy = mockFetch(200, {
      code: 'OK',
      total: 1,
      items: [
        {
          ean: '0885909950805',
          upc: '885909950805',
          title: 'Apple iPhone',
          brand: 'Apple',
          size: '',
          lowest_recorded_price: 999,
          images: ['http://insecure.example/a.jpg', 'https://cdn.example.com/a.jpg'],
        },
      ],
    });
    const r = await lookupUpcItemDb('885909950805');
    expect(r).toEqual({
      kind: 'FOUND',
      product: { source: 'UPCITEMDB', name: 'Apple iPhone', brand: 'Apple', quantity: null, imageCandidates: ['https://cdn.example.com/a.jpg'] },
    });
    expect(String(spy.mock.calls[0]![0])).toBe('https://api.upcitemdb.com/prod/trial/lookup?upc=885909950805');
  });

  it('لا عناصر مطابقة / INVALID_UPC → NOT_FOUND؛ حد الاستعمال → ERROR', async () => {
    mockFetch(200, { code: 'OK', total: 0, items: [] });
    expect(await lookupUpcItemDb('6131234567890')).toEqual({ kind: 'NOT_FOUND' });
    vi.restoreAllMocks();
    mockFetch(200, { code: 'OK', items: [{ ean: '9999999999999', title: 'غيره' }] });
    expect(await lookupUpcItemDb('6131234567890')).toEqual({ kind: 'NOT_FOUND' });
    vi.restoreAllMocks();
    mockFetch(400, { code: 'INVALID_UPC' });
    expect(await lookupUpcItemDb('6131234567890')).toEqual({ kind: 'NOT_FOUND' });
    vi.restoreAllMocks();
    mockFetch(429, { code: 'EXCEED_LIMIT' });
    expect((await lookupUpcItemDb('6131234567890')).kind).toBe('ERROR');
  });
});

describe('أدوات الباركود', () => {
  it('تطابق GTIN نصي يحفظ الأصفار ولا يقبل منتجًا مختلفًا', () => {
    expect(sameGtin('0012345678905', '0012345678905')).toBe(true);
    expect(sameGtin('012345678905', '0012345678905')).toBe(true); // UPC-A ↔ EAN-13
    expect(sameGtin('0012345678905', '12345678906')).toBe(false);
    expect(sameGtin('6131234567890', 6131234567890)).toBe(false); // رقم لا نص
    expect(isExternalLookupCandidate('0012345678905')).toBe(true);
    expect(isExternalLookupCandidate('ABC-1234')).toBe(false);
    expect(isExternalLookupCandidate('12345')).toBe(false);
    expect(pickBrand('COCA-COLA SERVICES SA/NV, Coca-Cola')).toBe('Coca-Cola');
    expect(pickBrand('  ')).toBeNull();
  });
});

describe('تنزيل الصور الخارجية (SSRF + الحجم + النوع + المهلة)', () => {
  let server: Server;
  let base: string;
  const png = makePng();

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(png);
      }
      if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<script>alert(1)</script>');
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'image/png' }); // بلا Content-Length: نقطع أثناء القراءة
        res.write(Buffer.alloc(600_000));
        res.write(Buffer.alloc(600_000));
        return res.end();
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      }
      if (req.url === '/slow') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return; // لا ينتهي أبدًا
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const opts = { maxBytes: 1_000_000, timeoutMs: 1500, allowLoopbackForTests: true };

  it('ينزّل صورة سليمة', async () => {
    const r = await downloadImage(`${base}/ok.png`, opts);
    expect(r.contentType).toBe('image/png');
    expect(r.bytes.equals(png)).toBe(true);
  });

  it('يرفض غير الصور، والضخم، والتحويلات، والمهلة', async () => {
    await expect(downloadImage(`${base}/html`, opts)).rejects.toMatchObject({ kind: 'BAD_TYPE' });
    await expect(downloadImage(`${base}/big`, opts)).rejects.toMatchObject({ kind: 'TOO_LARGE' });
    await expect(downloadImage(`${base}/redirect`, opts)).rejects.toMatchObject({ kind: 'BLOCKED' });
    await expect(downloadImage(`${base}/slow`, opts)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('SSRF: يرفض localhost والعناوين الداخلية وhttp والمنافذ والمضيفات خارج القائمة', async () => {
    const strict = { maxBytes: 1_000_000, timeoutMs: 1500 };
    for (const url of [
      `${base}/ok.png`, // http + loopback بدون إذن الاختبار
      'https://127.0.0.1/x.png',
      'https://10.0.0.5/x.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x.png',
      'https://localhost/x.png',
      'https://example.com:8443/x.png',
      'file:///etc/passwd',
      'https://user:pass@example.com/x.png',
    ]) {
      await expect(downloadImage(url, strict), url).rejects.toMatchObject({ kind: 'BLOCKED' });
    }
    await expect(
      downloadImage('https://evil.example/front.jpg', { ...strict, allowedHosts: ['images.openfoodfacts.org'] }),
    ).rejects.toMatchObject({ kind: 'BLOCKED' });
  });

  it('تصنيف العناوين', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '104.26.10.1', '2606:4700::1111']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});
