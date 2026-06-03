import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Component/unit tests for the dashboard. Pure presentational components + framework-free
// lib modules are tested here (jsdom + React Testing Library); Next server wiring is thin.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
