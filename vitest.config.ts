import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: './tests/jsdom-xhr-env.ts', include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['./tests/setup.ts'], restoreMocks: true, clearMocks: true } });
