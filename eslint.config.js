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

/**
 * 色・寸法は `src/ui/tokens/` のトークンだけを使う（DESIGN_SYSTEM.md §1）。
 * 生の値をその場で書けると、意図ではなく目分量が増える。0.1.0 の途中で
 * 文字サイズが 14 種類、角丸が 16 種類まで増えたのがそれ。
 */
const NO_RAW_DESIGN_VALUES = [
  {
    selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
    message:
      '色は `src/ui/tokens/` の役割トークンで指す。値を変えるときは scripts/design/ramps.py を直して `python3 scripts/design/generate.py`。',
  },
  {
    selector:
      'TemplateLiteral > TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,8})|^[0-9a-fA-F]{2}$/]',
    message:
      '色に透過を足して組み立てない。背面が分からないとコントラストを測れない。不透明なトークンを `src/ui/tokens/` に足す。',
  },
  {
    selector: "Property[key.name='fontSize'] > Literal[value>0]",
    message: '文字サイズは `typography` の役割から取る（字形アイコンは `icon`）。',
  },
  {
    selector: "Property[key.name='fontWeight'] > Literal",
    message: '太さは `typography` の役割に含まれている。単独で指定しない。',
  },
  {
    selector: "Property[key.name='borderRadius'] > Literal[value>1]",
    message: '角丸は `radius` から取る。入れ子は `concentric(外側, 余白)`。',
  },
  {
    selector:
      'Property[key.name=/^(padding|margin|gap|rowGap|columnGap)(Top|Bottom|Left|Right|Start|End|Horizontal|Vertical)?$/] > Literal[value>1]',
    message: '余白は `space` / `gutter` から取る。',
  },
];

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', 'pre-dev-sample/*', 'node_modules/*', 'coverage/*'],
  },
  {
    // 画面・features・ui はトークン経由でだけ色と寸法を書く（DESIGN_SYSTEM.md §1）
    files: ['src/app/**/*.tsx', 'src/features/**/*.tsx', 'src/ui/**/*.tsx'],
    ignores: ['src/ui/tokens/**'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_RAW_DESIGN_VALUES],
    },
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
