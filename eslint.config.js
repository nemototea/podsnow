// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

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
                'react-native',
                'expo-*',
              ],
              message: 'domain 層は infra / services / UI / ネイティブに依存しません。',
            },
          ],
        },
      ],
    },
  },
]);
