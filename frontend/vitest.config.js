import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests for the pure planning logic (dates, lanes). Run with `npm test`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    exclude: ['src/workReportUtils.test.js', 'node_modules/**'],   // that one is a node:test suite (see `npm run test:node`)
    globals: false,
  },
})
