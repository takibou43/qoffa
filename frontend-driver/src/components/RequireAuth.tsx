import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { LoadingBlock } from './ui';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
