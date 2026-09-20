import { en } from '../en';
import { ja } from '../ja';
import { FALLBACK_LOCALE, messagesFor, resolveLocale } from '../resolve';
import { LOCALES, type Locale } from '../types';

type Node = Record<string, unknown>;

/** 葉（文字列 / 関数）のパスと種別を集める。 */
function walk(
  node: Node,
  prefix = '',
): Map<string, { kind: 'string' | 'function'; arity: number }> {
  const out = new Map<string, { kind: 'string' | 'function'; arity: number }>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, { kind: 'string', arity: 0 });
    } else if (typeof value === 'function') {
      out.set(path, { kind: 'function', arity: value.length });
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of walk(value as Node, path)) out.set(k, v);
    } else {
      throw new Error(`カタログに文字列・関数・オブジェクト以外があります: ${path}`);
    }
  }
  return out;
}

const jaLeaves = walk(ja as unknown as Node);
const enLeaves = walk(en as unknown as Node);

describe('文言カタログ', () => {
  it('ja と en のキー集合が一致する', () => {
    // TypeScript でも縛っているが、`as` で逃げた場合を実行時にも落とす。
    expect([...enLeaves.keys()].sort()).toEqual([...jaLeaves.keys()].sort());
  });

  it('同じキーが同じ種別・同じ引数の数である', () => {
    const mismatches: string[] = [];
    for (const [path, jaLeaf] of jaLeaves) {
      const enLeaf = enLeaves.get(path);
      if (!enLeaf) continue; // 上のテストが報告する
      if (enLeaf.kind !== jaLeaf.kind || enLeaf.arity !== jaLeaf.arity) {
        mismatches.push(
          `${path}: ja=${jaLeaf.kind}/${jaLeaf.arity} en=${enLeaf.kind}/${enLeaf.arity}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(LOCALES)('%s に空の文言が無い', (locale) => {
    const empty: string[] = [];
    for (const [path, leaf] of walk(messagesFor(locale) as unknown as Node)) {
      if (leaf.kind !== 'string') continue;
      const value = path
        .split('.')
        .reduce<unknown>((acc, k) => (acc as Node)[k], messagesFor(locale));
      if (typeof value === 'string' && value.trim() === '') empty.push(path);
    }
    expect(empty).toEqual([]);
  });

  it('関数の文言が引数を実際に使っている（プレースホルダの取り違え検知）', () => {
    const suspicious: string[] = [];
    for (const locale of LOCALES) {
      const catalog = messagesFor(locale) as unknown as Node;
      for (const [path, leaf] of walk(catalog)) {
        if (leaf.kind !== 'function' || leaf.arity === 0) continue;
        const fn = path.split('.').reduce<unknown>((acc, k) => (acc as Node)[k], catalog) as (
          ...args: unknown[]
        ) => string;
        // 各引数に区別できる値を渡し、すべて出力に現れることを確かめる。
        const args = Array.from({ length: leaf.arity }, (_, i) => 1000 + i);
        const rendered = fn(...args);
        const missing = args.filter((a) => !rendered.includes(String(a)));
        if (missing.length) suspicious.push(`${locale}.${path} → "${rendered}"`);
      }
    }
    expect(suspicious).toEqual([]);
  });
});

describe('resolveLocale', () => {
  it('設定が固定なら端末ロケールを無視する', () => {
    expect(resolveLocale('ja', ['en-US'])).toBe('ja');
    expect(resolveLocale('en', ['ja-JP'])).toBe('en');
  });

  it("'system' なら端末の優先順で最初に対応しているものを採る", () => {
    expect(resolveLocale('system', ['ja-JP', 'en-US'])).toBe('ja');
    expect(resolveLocale('system', ['en-US', 'ja-JP'])).toBe('en');
    expect(resolveLocale('system', ['fr-FR', 'ja'])).toBe('ja');
  });

  it('地域・大文字・アンダースコア付きのタグを言語コードに正規化する', () => {
    expect(resolveLocale('system', ['ja-JP'])).toBe('ja');
    expect(resolveLocale('system', ['ja_JP'])).toBe('ja');
    expect(resolveLocale('system', ['JA'])).toBe('ja');
    expect(resolveLocale('system', ['en-GB'])).toBe('en');
  });

  it('未対応の言語しか無ければフォールバックする', () => {
    expect(resolveLocale('system', ['fr-FR', 'de-DE'])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale('system', [])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale('system', [null, undefined, ''])).toBe(FALLBACK_LOCALE);
  });

  it('対応ロケールすべてにカタログがある', () => {
    for (const locale of LOCALES) {
      expect(typeof messagesFor(locale as Locale).app.name).toBe('string');
    }
  });
});
