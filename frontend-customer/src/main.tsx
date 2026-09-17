import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// تسجيل Service Worker للتثبيت والعمل دون اتصال (للصفحات غير الحسّاسة فقط)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // فشل التسجيل لا يمنع استعمال التطبيق
    });
  });
}
