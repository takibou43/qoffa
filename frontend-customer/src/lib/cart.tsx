import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Product } from './types';

/**
 * السلة محلية في المتصفح فقط.
 * المبالغ هنا للعرض التقريبي — الخادم يعيد حساب كل شيء من قاعدة البيانات عند إنشاء الطلب.
 */
export interface CartLine {
  productId: string;
  name: string;
  unit: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
}

interface CartState {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  lines: CartLine[];
}

const EMPTY: CartState = { shopId: null, shopName: null, deliveryFee: 0, lines: [] };
const STORAGE_KEY = 'qoffa.cart';

interface CartValue extends CartState {
  itemCount: number;
  subtotal: number;
  add: (
    shop: { id: string; name: string; deliveryFee: number },
    product: Product,
    quantity?: number,
  ) => { replaced: boolean };
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartValue | null>(null);

function load(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // تخزين ممتلئ أو محظور — السلة تبقى في الذاكرة
    }
  }, [state]);

  /** منتج من محل مختلف يستبدل السلة: الطلب الواحد من محل واحد */
  const add: CartValue['add'] = useCallback((shop, product, quantity = 1) => {
    let replaced = false;
    setState((current) => {
      if (current.shopId && current.shopId !== shop.id) {
        replaced = true;
        return {
          shopId: shop.id,
          shopName: shop.name,
          deliveryFee: shop.deliveryFee,
          lines: [
            {
              productId: product.id,
              name: product.name,
              unit: product.unit,
              price: product.price,
              quantity,
              imageUrl: product.imageUrl,
            },
          ],
        };
      }

      const existing = current.lines.find((l) => l.productId === product.id);
      const lines = existing
        ? current.lines.map((l) =>
            l.productId === product.id ? { ...l, quantity: l.quantity + quantity } : l,
          )
        : [
            ...current.lines,
            {
              productId: product.id,
              name: product.name,
              unit: product.unit,
              price: product.price,
              quantity,
              imageUrl: product.imageUrl,
            },
          ];

      return { shopId: shop.id, shopName: shop.name, deliveryFee: shop.deliveryFee, lines };
    });
    return { replaced };
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setState((current) => {
      const lines =
        quantity <= 0
          ? current.lines.filter((l) => l.productId !== productId)
          : current.lines.map((l) =>
              l.productId === productId ? { ...l, quantity: Math.min(quantity, 99) } : l,
            );
      return lines.length === 0 ? EMPTY : { ...current, lines };
    });
  }, []);

  const remove = useCallback((productId: string) => setQuantity(productId, 0), [setQuantity]);
  const clear = useCallback(() => setState(EMPTY), []);

  const value = useMemo<CartValue>(() => {
    const itemCount = state.lines.reduce((sum, l) => sum + l.quantity, 0);
    const subtotal = state.lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    return { ...state, itemCount, subtotal, add, setQuantity, remove, clear };
  }, [state, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart يجب أن يُستعمل داخل CartProvider');
  return context;
}
