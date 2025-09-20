/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{unit.test,integration.test,e2e.test}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['legacy/**', 'node_modules/**', 'dist/**'],
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
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
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