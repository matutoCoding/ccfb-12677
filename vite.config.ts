import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯本地离线工程：base 用相对路径，产物可直接 file:// 或任意静态目录打开
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
