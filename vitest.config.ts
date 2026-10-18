import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The end-to-end test launches Chromium and walks a page; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
