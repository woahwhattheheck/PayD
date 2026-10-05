import { defineConfig } from 'vitest/config';

// Hook tests do not need the app's WASM plugins or generated contract clients.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/hooks/__tests__/*.test.tsx'],
    setupFiles: ['src/hooks/__tests__/setup.ts'],
    clearMocks: true,
    maxWorkers: 2,
  },
});
