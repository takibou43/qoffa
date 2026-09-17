import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * في التطوير والمعاينة المحلية نمرّر /api إلى الخادم عبر proxy.
 * في الإنتاج يُضبط VITE_API_URL على عنوان الـAPI الكامل عند البناء.
 */
const proxy = {
  '/api': {
    target: process.env.VITE_API_PROXY || 'http://localhost:4000',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
