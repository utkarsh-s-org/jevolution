import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../dist/arena', emptyOutDir: true, rollupOptions: { input: 'arena.html' } },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
});
