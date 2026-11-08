import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

const forbiddenInCore = [
  '@nestjs/*',
  '@prisma/client',
  'argon2',
  'jsonwebtoken',
  'passport',
  'passport-jwt',
  'tesseract.js',
  'pdf-parse',
  'file-type',
  'image-size',
  'multer',
  'helmet',
  'express',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs', globals: { module: 'writable' } } },
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain' },
        { type: 'application', pattern: 'src/application' },
        { type: 'infrastructure', pattern: 'src/infrastructure' },
        { type: 'presentation', pattern: 'src/presentation' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        2,
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'domain' } }, allow: { to: { element: { type: 'domain' } } } },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: ['domain', 'application'] } } },
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: { to: { element: { types: ['domain', 'application', 'infrastructure'] } } },
            },
            {
              from: { element: { type: 'presentation' } },
              allow: {
                to: { element: { types: ['domain', 'application', 'infrastructure', 'presentation'] } },
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbiddenInCore.map((group) => ({
            group: [group],
            message: 'domain/application não podem depender de framework ou infraestrutura.',
          })),
        },
      ],
    },
  },
);
