import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    // Strip .js extensions so vitest resolves TypeScript source files directly.
    // This matches the ESM import convention used throughout the project.
    alias: [
      { find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' },
    ],
  },
});
