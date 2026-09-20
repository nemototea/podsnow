// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

/** 文言は `src/i18n/` だけに置く（ARCHITECTURE.md §2、REQUIREMENTS.md FR-I18N-4）。 */
const NO_I18N_IMPORT = {
  group: ['@/i18n', '@/i18n/*'],
  message:
    '文言は UI 層（app / features / ui）でのみ引く。ここではエラーは AppErrorCode で返し、DB に書く既定文言は ServiceLabels で受け取る。',
};

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', 'pre-dev-sample/*', 'node_modules/*', 'coverage/*'],
  },
  {
    // domain/ は副作用を持たない（ARCHITECTURE.md §2）
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/infra/*',
                '@/services/*',
                '@/features/*',
                '@/app/*',
                '@/ui/*',
                'react-native',
                'expo-*',
              ],
              message: 'domain 層は infra / services / UI / ネイティブに依存しません。',
            },
            NO_I18N_IMPORT,
          ],
        },
      ],
    },
  },
  {
    // services/ と infra/ は文言を持たない（Issue #80、FR-I18N-4）
    files: ['src/services/**/*.ts', 'src/infra/**/*.ts'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_I18N_IMPORT] }],
    },
  },
]);
