/**
 * لمسات بصرية للتصنيفات: إيموجي مفهوم للجميع + لون خلفية فاتح لكل بطاقة.
 * نطابق بالكلمات (عربي/فرنسي/إنجليزي) في الاسم أو الـslug أو iconKey — بلا أي تغيير في الـBackend.
 */
const RULES: { keys: string[]; emoji: string }[] = [
  { keys: ['خضر', 'خضار', 'légume', 'legume', 'vegetable', 'veg'], emoji: '🥬' },
  { keys: ['فواكه', 'فاكهة', 'fruit'], emoji: '🍎' },
  { keys: ['لحم', 'لحوم', 'جزار', 'دجاج', 'boucher', 'viande', 'meat', 'butcher', 'poulet'], emoji: '🥩' },
  { keys: ['سمك', 'أسماك', 'poisson', 'fish'], emoji: '🐟' },
  { keys: ['خبز', 'مخبز', 'مخابز', 'boulang', 'pain', 'bakery', 'bread'], emoji: '🥖' },
  { keys: ['حلوي', 'حلويات', 'pâtiss', 'patiss', 'sweet', 'gateau', 'cake'], emoji: '🍰' },
  { keys: ['حليب', 'ألبان', 'البان', 'أجبان', 'lait', 'laitier', 'dairy', 'milk', 'fromage'], emoji: '🥛' },
  { keys: ['مشروب', 'مشروبات', 'عصير', 'boisson', 'drink', 'beverage', 'juice'], emoji: '🥤' },
  { keys: ['زيت', 'huile', 'oil'], emoji: '🫒' },
  { keys: ['قهوة', 'شاي', 'café', 'cafe', 'coffee', 'tea', 'thé'], emoji: '☕' },
  { keys: ['تنظيف', 'منظفات', 'nettoy', 'clean', 'déterg', 'deterg'], emoji: '🧴' },
  { keys: ['أطفال', 'رضع', 'bébé', 'bebe', 'baby'], emoji: '🍼' },
  { keys: ['صيدل', 'parapharm', 'pharma'], emoji: '💊' },
  { keys: ['عجائن', 'معكرونة', 'pâte', 'pate', 'pasta', 'كسكس', 'couscous'], emoji: '🍝' },
  { keys: ['تمر', 'تمور', 'datte', 'date'], emoji: '🌴' },
  { keys: ['بقال', 'مواد غذائية', 'حانوت', 'épicerie', 'epicerie', 'grocery', 'supérette', 'superette', 'alimentation'], emoji: '🛒' },
  { keys: ['سوبر', 'supermarch', 'market'], emoji: '🏬' },
];

export function categoryEmoji(c: { name: string; slug?: string; iconKey?: string | null }, fallback = '🛒') {
  const hay = `${c.name} ${c.slug ?? ''} ${c.iconKey ?? ''}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.keys.some((k) => hay.includes(k.toLowerCase()))) return rule.emoji;
  }
  return fallback;
}

/** ألوان خلفيات هادئة بالتناوب (مثل بطاقات التصنيفات في التصاميم المرجعية) */
const TILE_TONES = [
  'bg-emerald-50 ring-emerald-100',
  'bg-amber-50 ring-amber-100',
  'bg-rose-50 ring-rose-100',
  'bg-violet-50 ring-violet-100',
  'bg-sky-50 ring-sky-100',
  'bg-lime-50 ring-lime-100',
  'bg-orange-50 ring-orange-100',
  'bg-teal-50 ring-teal-100',
];

export const tileTone = (index: number) => TILE_TONES[index % TILE_TONES.length];

/** خلفيات فاتحة جدًا لصور المنتجات حتى تبرز الصورة */
const PRODUCT_TONES = ['bg-emerald-50', 'bg-amber-50', 'bg-rose-50', 'bg-sky-50', 'bg-lime-50', 'bg-violet-50'];

export function productTone(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PRODUCT_TONES[Math.abs(h) % PRODUCT_TONES.length];
}
