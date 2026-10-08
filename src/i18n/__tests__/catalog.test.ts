import { LOCALES } from '@/domain/locale';

import { en } from '../en';
import { ja } from '../ja';
import { messagesFor } from '../resolve';

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

  describe('文体（DESIGN_SYSTEM.md §2.2）', () => {
    const rendered = (catalog: Node): [string, string][] =>
      [...walk(catalog)].map(([path, leaf]) => {
        const v = path.split('.').reduce<unknown>((acc, k) => (acc as Node)[k], catalog);
        const text =
          leaf.kind === 'function'
            ? (v as (...a: unknown[]) => string)(...Array.from({ length: leaf.arity }, () => '1'))
            : (v as string);
        return [path, text];
      });
    const ACRONYMS = new Set([
      'AAC',
      'AGC',
      'BGM',
      'LUFS',
      'M4A',
      'MVP',
      'RSS',
      'URL',
      'USB',
      'UTF',
      'WAV',
      'YYYY',
    ]);

    // 決まった場所でだけ許す語。看板の語（DESIGN_SYSTEM.md §2.4。#235 で消す部品のもの）と、
    // 録音している状態の表示「REC」（ユーザー判断 2026-10-06、#235。§2.1 の例外、§2.2 の用語の表）。
    const SIGNS: Record<string, readonly string[]> = {
      'record.recPill': ['REC'],
      'record.stateRecording': ['REC'],
      'androidNotification.title': ['REC'],
      'androidNotification.channelDescription': ['REC'],
    };

    it.each(LOCALES)('%s に全部大文字の語が無い（略語と看板の語を除く）', (locale) => {
      const found = rendered(messagesFor(locale) as unknown as Node).flatMap(([path, text]) =>
        (text.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? [])
          .filter((w) => !ACRONYMS.has(w) && !SIGNS[path]?.includes(w))
          .map((w) => `${path}: ${w}`),
      );
      expect(found).toEqual([]);
    });

    it('ja に呼びかけ・キャッチコピー調の言い回しが無い', () => {
      const found = rendered(ja as unknown as Node)
        .filter(([, text]) => /しましょう|大丈夫|、ここから|へ。$/.test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    it('ja の 1 文だけの文言は句点で終えない', () => {
      const found = rendered(ja as unknown as Node)
        .filter(([, text]) => text.endsWith('。') && text.indexOf('。') === text.length - 1)
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    it('en に呼びかけ・感嘆が無い', () => {
      const found = rendered(en as unknown as Node)
        .filter(([, text]) => /Let[’']s|!/.test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    it.each(LOCALES)('%s に括弧で囲んだだけの代わりの文言が無い', (locale) => {
      // 「（タイトル未設定）」のように全体を括弧で囲むと、行頭がずれてほかの行と揃わない（Issue #170 E7）。
      const allowed = new Set(['sound.recommended']);
      const found = rendered(messagesFor(locale) as unknown as Node)
        .filter(([path, text]) => !allowed.has(path) && /^[（(].*[）)]$/.test(text.trim()))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });
  });

  describe('用語と表記（DESIGN_SYSTEM.md §2.2 の用語の表、Issue #170）', () => {
    const rendered = (catalog: Node): [string, string][] =>
      [...walk(catalog)].map(([path, leaf]) => {
        const v = path.split('.').reduce<unknown>((acc, k) => (acc as Node)[k], catalog);
        const text =
          leaf.kind === 'function'
            ? (v as (...a: unknown[]) => string)(...Array.from({ length: leaf.arity }, () => '1'))
            : (v as string);
        return [path, text];
      });

    it.each(LOCALES)('%s の話数の表記は episode.number だけが作る', (locale) => {
      const catalog = messagesFor(locale);
      expect(catalog.episode.number(3)).toBe('#3');
      // 話数を受け取る文言は、episode.number で作った表記を受け取る（自分で `#` を付けない）。
      // 読み上げ（a11y*）は「エピソード 3」と文で読むので対象外。
      const found = rendered(catalog as unknown as Node)
        .filter(([path]) => path !== 'episode.number' && !/(^|\.)a11y/.test(path))
        .filter(([, text]) => /#\d|\bEP\.|エピソード \d|Episode \d/.test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    /** [使わない語, 許す場所（パスの前方一致）, 理由] */
    type Rule = [RegExp, readonly string[], string];
    const RULES: Record<'ja' | 'en', readonly Rule[]> = {
      ja: [
        [/カット/, [], '音を消す操作は「削除」'],
        [/無音を削除/, [], '無音は「詰める」'],
        [/しゃべり中|声に合わせて|声の間は/, [], 'BGM を声の間だけ下げるのは「ダッキング」'],
        [
          /トークテーマ|台本|チャプター|メモ/,
          [],
          '話す内容を書いておくものは「カンペ」（Issue #180）',
        ],
        [
          /収録/,
          [
            'episode.tabs.studio',
            'export.emptyVoice',
            'details.recordedEyebrow',
            'details.badDate',
            'metadata.recordedAt',
            'player.recordedOn',
          ],
          '操作と音は「録音」。「収録」はタブの名前と収録日だけ',
        ],
        [
          /取り込/,
          ['errors.import_', 'home.importShow', 'home.onboarding', 'podcastImport.'],
          '「取り込む」は配信中の番組だけ。素材は「読み込む」「追加」',
        ],
        [/[A-Z][a-z]+ [A-Z][a-z]+/, ['app.', 'settings.language.'], '英語のまま残さない'],
        [/録音タブ/, [], '今は「収録」タブ'],
      ],
      en: [
        [/\bcut\b(?! off)/i, [], 'Removing audio is “Delete”'],
        [/lower(ed|s)? (music|BGM )?(under|while)/i, [], 'Call it “ducking”'],
        [/\btakes?\b/i, [], 'Say “recording”'],
        [/\basset/i, [], 'Say “sound”'],
        [/· (mono|stereo|uncompressed)\b/, [], 'Spec lines capitalise each item'],
        [/High Quality/, [], 'Sentence case'],
        [/Record tab/, [], 'The tab is “Studio”'],
        [/talking points?|\bscript\b|\bchapters?\b/i, [], 'Say “Notes” (Issue #180)'],
        [
          /import/i,
          ['errors.import_', 'home.importShow', 'home.onboarding', 'podcastImport.'],
          '“Import” is only for an existing show',
        ],
      ],
    };

    it.each(LOCALES)('%s に揺れた用語が無い', (locale) => {
      const found = rendered(messagesFor(locale) as unknown as Node).flatMap(([path, text]) =>
        RULES[locale]
          .filter(([re, allow]) => re.test(text) && !allow.some((a) => path.startsWith(a)))
          .map(([, , why]) => `${path}: ${text} → ${why}`),
      );
      expect(found).toEqual([]);
    });

    it.each(LOCALES)('%s の専門用語の説明（ⓘ）は用語と 3 文までの説明を持つ', (locale) => {
      const { glossary } = messagesFor(locale);
      const { a11yInfo, ...terms } = glossary;
      expect(a11yInfo('X')).toContain('X');
      for (const [key, { term, body }] of Object.entries(terms)) {
        expect([key, term.trim().length > 0]).toEqual([key, true]);
        const sentences = body.split(locale === 'ja' ? '。' : /\.\s|\.$/).filter((x) => x.trim());
        expect([key, sentences.length <= 3]).toEqual([key, true]);
      }
    });

    it.each(LOCALES)('%s の書き出しプリセットは設定と書き出しで同じ名前・仕様', (locale) => {
      const { export: ex, settings } = messagesFor(locale);
      for (const k of ['podcast', 'high', 'wav'] as const) {
        expect(settings.presets[k].label).toBe(ex.presets[k].label);
        expect(settings.presets[k].sub).toBe(ex.presets[k].spec);
      }
      expect(settings.presets.custom.label).toBe(ex.presets.custom.label);
      expect(settings.mono).toBe(ex.custom.mono);
      expect(settings.stereo).toBe(ex.custom.stereo);
    });
  });
});
