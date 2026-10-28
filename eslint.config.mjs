import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['**/*.{ts,tsx,mts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended]
});
