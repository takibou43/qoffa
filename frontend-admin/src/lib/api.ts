import { request } from './apiCore';
import type {
  AdminDriver,
  AdminOrder,
  AdminShop,
  ApprovalStatus,
  AuditLog,
  OrderStatus,
  Paginated,
  Role,
  Stats,
  User,
  Wallet,
} from './types';

export { ApiError, clearToken, getToken, setToken } from './apiCore';

export const api = {
  /** المعرّف: بريد إلكتروني (يحوي @) أو رقم هاتف */
  login: (identifier: string, password: string) =>
    request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: identifier.includes('@')
        ? { email: identifier, password }
        : { phone: identifier, password },
      auth: false,
    }),

  me: () => request<{ user: User }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  platform: () =>
    request<{ platform: { name: string; tagline: string; currency: string; owner: { name: string; email: string } | null } }>(
      '/admin/platform',
    ),

  stats: () => request<{ stats: Stats }>('/admin/stats'),

  users: (params: { role?: Role; status?: string; q?: string; page?: number; limit?: number }) =>
    request<Paginated<User>>('/admin/users', { query: params }),

  setUserStatus: (userId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) =>
    request<{ user: User }>(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: { status, reason },
    }),

  /** لمالك المنصة فقط — الخادم يرفض غير ذلك */
  createAdmin: (input: { fullName: string; phone: string; email: string; password: string }) =>
    request<{ user: User }>('/admin/admins', { method: 'POST', body: input }),

  removeAdmin: (userId: string) =>
    request<{ ok: true }>(`/admin/admins/${userId}`, { method: 'DELETE' }),

  shops: (params: { status?: string; q?: string; page?: number; limit?: number }) =>
    request<Paginated<AdminShop>>('/admin/shops', { query: params }),

  setShopStatus: (shopId: string, status: ApprovalStatus, reason?: string) =>
    request<{ shop: unknown }>(`/admin/shops/${shopId}/status`, {
      method: 'PATCH',
      body: { status, reason },
    }),

  setShopCommission: (shopId: string, commissionBps: number) =>
    request<{ shop: unknown }>(`/admin/shops/${shopId}/commission`, {
      method: 'PATCH',
      body: { commissionBps },
    }),

  drivers: (params: { status?: string; q?: string; page?: number; limit?: number }) =>
    request<Paginated<AdminDriver>>('/admin/drivers', { query: params }),

  setDriverStatus: (driverId: string, status: ApprovalStatus, reason?: string) =>
    request<{ driver: unknown }>(`/admin/drivers/${driverId}/status`, {
      method: 'PATCH',
      body: { status, reason },
    }),

  orders: (params: { status?: OrderStatus; q?: string; page?: number; limit?: number }) =>
    request<Paginated<AdminOrder>>('/admin/orders', { query: params }),

  order: (id: string) => request<{ order: Record<string, unknown> }>(`/orders/${id}`),

  wallets: (params: { page?: number; limit?: number } = {}) =>
    request<{ items: Wallet[]; meta: Record<string, number> }>('/admin/wallets', { query: params }),

  auditLog: (params: { targetType?: string; page?: number; limit?: number } = {}) =>
    request<Paginated<AuditLog>>('/admin/audit-log', { query: params }),

  settings: () =>
    request<{ items: { key: string; value: unknown; label: string; group: string }[] }>(
      '/admin/settings',
    ),
};
