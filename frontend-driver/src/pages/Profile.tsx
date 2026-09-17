import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Alert, Button, ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DriverProfile } from '../lib/types';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  SUSPENDED: 'معلّق',
};

export default function Profile() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .profile()
      .then((r) => setProfile(r.driver))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock />;
  if (!profile) return <ErrorState message={error ?? 'تعذّر تحميل الملف'} />;

  return (
    <div>
      <PageHeader title="حسابي" />
      <div className="space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-base font-bold text-slate-900">{user?.fullName}</p>
          <p className="text-sm text-slate-500">{user?.phone}</p>
        </section>

        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">حالة الحساب</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                profile.status === 'APPROVED'
                  ? 'bg-brand-50 text-brand-700'
                  : profile.status === 'PENDING'
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-red-50 text-red-700'
              }`}
            >
              {STATUS_LABEL[profile.status]}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">التوفر</span>
            <span>{profile.isAvailable ? 'متاح' : 'غير متاح'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">وسيلة التنقّل</span>
            <span>{profile.vehicleType}</span>
          </div>
          {profile.plateNumber && (
            <div className="flex justify-between">
              <span className="text-slate-500">رقم اللوحة</span>
              <span dir="ltr">{profile.plateNumber}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">التقييم</span>
            <span>
              {profile.ratingCount === 0
                ? 'لا توجد تقييمات بعد'
                : `⭐ ${profile.ratingAvg.toFixed(1)} (${profile.ratingCount})`}
            </span>
          </div>
        </section>

        <Alert kind="info">
          موقعك يُستعمل فقط لترتيب العروض القريبة منك، ويُحدَّث عند تفعيل التوفر. لا يوجد تتبّع مستمر.
        </Alert>

        <Button variant="secondary" className="w-full" onClick={logout}>
          تسجيل الخروج
        </Button>
      </div>
    </div>
  );
}
