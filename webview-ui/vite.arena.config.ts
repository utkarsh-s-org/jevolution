import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  define: {
    'import.meta.env.VITE_ARENA_HOSTED': JSON.stringify(
      process.env.VITE_ARENA_HOSTED ?? (command === 'serve' ? 'true' : 'false'),
    ),
  },
  plugins: [react()],
  build: { outDir: '../dist/arena', emptyOutDir: true, rollupOptions: { input: 'arena.html' } },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': { target: process.env.ARENA_API_URL || 'http://127.0.0.1:4319', changeOrigin: true },
    },
  },
}));
