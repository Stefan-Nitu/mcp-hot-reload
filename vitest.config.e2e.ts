/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{integration.test,e2e.test}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['legacy/**', 'node_modules/**', 'dist/**'],
    // Run E2E and integration tests sequentially to avoid resource conflicts
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    forceRerunTriggers: ['**/vitest.config.*/**', '**/vite.config.*/**'],
    dangerouslyIgnoreUnhandledErrors: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'legacy/',
        '**/*.config.ts',
        '**/*.config.js',
        '**/*.config.cjs',
        'src/**/*.unit.test.ts',
        'src/**/*.integration.test.ts',
        'src/**/*.e2e.test.ts',
        'src/__tests__/**',
        'src/types/**',
        'src/index.ts',
        'examples/**',
        '.github/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  esbuild: {
    target: 'node18'
  }
});