// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Essential quality rules for MCP servers
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': 'off', // Allow console for MCP server debugging
      'max-lines': ['error', { max: 600, skipBlankLines: true }],
      '@typescript-eslint/no-explicit-any': 'off', // Temporarily disabled for release
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js', '*.mjs']
  }
);