const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // بدون I و O لتفادي اللبس

/** رقم طلب قصير يقرأه البشر: QF-XXXXXX */
export function generateOrderCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `QF-${out}`;
}
