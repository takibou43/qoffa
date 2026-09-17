import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxy = {
  '/api': {
    target: process.env.VITE_API_PROXY || 'http://localhost:4000',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5175, proxy },
  preview: { port: 5175, proxy },
});
