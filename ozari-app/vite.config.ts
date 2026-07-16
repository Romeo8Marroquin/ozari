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
      // Full coverage is enforced: the suite fails if any metric regresses below 100%. Genuinely
      // untestable code (DEV-only logs, SSR guards, trusted-gesture paths, pure GSAP orchestration)
      // is either `/* v8 ignore */`d with a reason at the source or excluded below — never left as a
      // silent gap. Keep it honest: prefer a real test; reach for an ignore/exclude only when a line
      // truly cannot run under jsdom.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      // Vitest 4 reports every file matched by `include` (untested ones show as 0%) by default,
      // so no `all` flag is needed — this keeps the coverage picture honest.
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
        // Genuinely untestable in jsdom: relies on **trusted** DOM gestures, which jsdom forces to
        // `isTrusted: false` and can't forge — so the real-gesture path can't be exercised.
        'src/hooks/useUserGesture.ts',
        // Unused legacy component (only self-referenced) whose loading state is driven by a GSAP
        // mid-timeline callback that doesn't tick under jsdom.
        'src/components/CustomButton.tsx',
        // Pure GSAP animation orchestration for the auth card (enter/leave/redirect timelines,
        // COVER keyframes, resize-snap) — no business logic; verified visually, not by unit tests.
        'src/modules/sesion/hooks/useAuthCard.ts',
        // Pure GSAP choreography shared by the panel pages (stagger in/out sweeps, header title,
        // default body fade) — no business logic; the pages' STATE decisions and the layout's
        // transition CONTROLLER are tested, these timelines are visual-only.
        'src/modules/panel/pageMotion.ts',
        // The card→detail shared-element image transition (fixed clone + GSAP travel between the
        // pages) — pure visual orchestration on top of the standard transition, verified by eye;
        // the components' begin/claim DECISIONS are what the unit tests pin.
        'src/modules/panel/products/productImageMorph.ts',
      ],
    },
  },
});
