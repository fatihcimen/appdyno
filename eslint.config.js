import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** What is clean under the type-checked rules: the rest keeps the recommended ones until it is, and then this goes. */
const strict = [
  '*.js',
  '*.ts',
  'packages/protocol/**',
  'packages/mcp/**',
  'packages/flows/**',
  'packages/cli/**',
  'packages/core/**',
  'packages/ops/**',
  'packages/hub/**',
  'device-tests/**',
  'packages/driver-apple/**',
];

export default defineConfig(
  { ignores: ['**/dist/**', 'android/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        performance: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: strict,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // the code declares its shapes by `type`, and an alias passes for a Record, which an interface does not
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      // a number reads as itself in text; undefined, an object and any still have to be said how
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
      // prettier keeps `() => f()` on one line and spreads `() => { f(); }` on three, the option's own reason
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // '' is no text and false is no here, so `||` passes over them as meant; a number or an object still has to say
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true, boolean: true } },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
