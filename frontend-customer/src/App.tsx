import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import Account from './pages/Account';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Home from './pages/Home';
import Login from './pages/Login';
import Notifications from './pages/Notifications';
import OrderDetail from './pages/OrderDetail';
import Orders from './pages/Orders';
import Register from './pages/Register';
import ShopPage from './pages/Shop';

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="shops/:shopId" element={<ShopPage />} />
              <Route path="cart" element={<Cart />} />
              <Route
                path="checkout"
                element={
                  <RequireAuth>
                    <Checkout />
                  </RequireAuth>
                }
              />
              <Route
                path="orders"
                element={
                  <RequireAuth>
                    <Orders />
                  </RequireAuth>
                }
              />
              <Route
                path="orders/:orderId"
                element={
                  <RequireAuth>
                    <OrderDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="notifications"
                element={
                  <RequireAuth>
                    <Notifications />
                  </RequireAuth>
                }
              />
              <Route path="account" element={<Account />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
