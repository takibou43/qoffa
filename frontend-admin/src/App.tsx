import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import { AuthProvider } from './lib/auth';
import AuditLogPage from './pages/AuditLog';
import Dashboard from './pages/Dashboard';
import DeliveryPricingPage from './pages/DeliveryPricing';
import Drivers from './pages/Drivers';
import Login from './pages/Login';
import Orders from './pages/Orders';
import Products from './pages/Products';
import Shops from './pages/Shops';
import Users from './pages/Users';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="shops" element={<Shops />} />
            <Route path="products" element={<Products />} />
            <Route path="drivers" element={<Drivers />} />
            <Route path="orders" element={<Orders />} />
            <Route path="delivery-pricing" element={<DeliveryPricingPage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
