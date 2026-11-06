import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 30000, setupFiles: ['test/setup-tod.ts'], exclude: ['**/node_modules/**', '.local/**', 'dist/**', 'dist-dev/**'] } });
