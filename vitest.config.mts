import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Claude Code's worktrees are whole copies of the project: their tests are not this checkout's.
    exclude: ['**/node_modules/**', '.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // Outside Next, `server-only` throws on import; in tests it is just a marker.
      'server-only': path.resolve(import.meta.dirname, 'node_modules/server-only/empty.js'),
    },
  },
});
