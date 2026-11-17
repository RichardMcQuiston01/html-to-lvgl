import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The editor talks to `html2lvgl --preview-api` through a same-origin `/api`
 * proxy (no CORS to configure). Point it elsewhere with HTML2LVGL_PREVIEW_URL.
 */
const previewApiUrl: string = process.env.HTML2LVGL_PREVIEW_URL ?? 'http://127.0.0.1:8787';

const apiProxy = {
  '/api': {
    target: previewApiUrl,
    changeOrigin: true,
    rewrite: (path: string): string => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: apiProxy, fs: { allow: ['..'] } },
  preview: { proxy: apiProxy },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
