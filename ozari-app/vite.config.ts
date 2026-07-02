import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import path from 'path';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@sesion': path.resolve(__dirname, './src/modules/sesion'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@components': path.resolve(__dirname, './src/components'),
      '@constants': path.resolve(__dirname, './src/constants'),
      '@functions': path.resolve(__dirname, './src/utils/functions'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@api': path.resolve(__dirname, './src/api'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // When testing from a phone over the LAN (`pnpm dev --host`), the browser's Origin is
        // `http://<lan-ip>:5173`, which the API's CORS + API-key origin checks (both keyed to
        // APP_HOST) would reject. `changeOrigin` only rewrites Host, so rewrite the forwarded
        // Origin to the API's expected dev host — LAN dev traffic is then treated exactly like
        // localhost. Dev-proxy only; never ships (prod uses VITE_API_URL + real CORS).
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://localhost:5173');
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // `all` so untested source files show up as 0% (honest coverage), not silently omitted.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Tests + test infra
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Type-only / generated / config — no runtime logic to cover
        'src/**/*.d.ts',
        'src/types/**',
        'src/constants/**',
        'src/routeTree.gen.ts',
        // App bootstrap + framework wiring (exercised e2e, not unit): entry, i18n init, route defs
        'src/main.tsx',
        'src/i18n.ts',
        'src/routes/**',
        'src/assets/**',
      ],
    },
  },
});
