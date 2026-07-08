import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['tests/client/**', 'jsdom'],
      ['tests/server/**', 'node']
    ],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true
  }
});
