import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { 'react-native': fileURLToPath(new URL('./tests/react-native.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/__tests__/*.test.{ts,tsx}'], setupFiles: ['./tests/setup.ts'] },
});
