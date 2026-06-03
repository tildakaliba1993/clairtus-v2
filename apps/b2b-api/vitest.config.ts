import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS DI needs decorator metadata, which esbuild (vitest's default) does not emit.
// SWC emits it — this is the standard NestJS + vitest setup.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-test.ts', 'src/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    hookTimeout: 30000,
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
