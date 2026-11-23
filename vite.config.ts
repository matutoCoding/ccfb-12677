import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base 用相对路径, 构建产物可脱离服务器离线打开; singlefile 将全部资源内联进单个 HTML
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
