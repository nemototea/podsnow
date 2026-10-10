import {
  commonDescriptionLines,
  descriptionLines,
  isUntouchedTemplate,
  normalizeLine,
  recentDescriptions,
  suggestDescriptionTemplate,
  TEMPLATE_SAMPLE_SIZE,
} from '../descriptionTemplate';

const FOOTER = ['――――――', 'お便りはこちら https://forms.example.com/x', 'X: @show #番組'];
const ep = (n: number, footer: readonly string[] = FOOTER) =>
  [`第${n}回は${n}の話をしました。`, '', ...footer].join('\n');

describe('normalizeLine', () => {
  it('treats full-width / half-width and whitespace runs as the same line', () => {
    expect(normalizeLine('  Ｘ：　@show  #番組 ')).toBe(normalizeLine('X: @show #番組'));
  });
});

describe('descriptionLines', () => {
  it('turns HTML into trimmed text lines', () => {
    expect(
      descriptionLines('<p>本文</p><p>お便り <a href="https://a">フォーム</a><br/>X: @show</p>'),
    ).toEqual(['本文', 'お便り フォーム', 'X: @show']);
  });
});

describe('recentDescriptions', () => {
  it('takes the newest episodes with a description, newest first', () => {
    const items = [
      { description: 'a', publishedAt: 1 },
      { description: '', publishedAt: 9 },
      { description: '<p> </p>', publishedAt: 8 },
      { description: 'c', publishedAt: 3 },
      { description: 'b', publishedAt: 2 },
      { description: 'z', publishedAt: null },
    ];
    expect(recentDescriptions(items, 3)).toEqual(['c', 'b', 'a']);
    expect(recentDescriptions(items)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('keeps feed order for equal dates', () => {
    const items = [
      { description: 'x', publishedAt: 1 },
      { description: 'y', publishedAt: 1 },
    ];
    expect(recentDescriptions(items)).toEqual(['x', 'y']);
  });

  it('looks at TEMPLATE_SAMPLE_SIZE episodes by default', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ description: `d${i}`, publishedAt: i }));
    expect(recentDescriptions(items)).toHaveLength(TEMPLATE_SAMPLE_SIZE);
  });
});

describe('commonDescriptionLines', () => {
  it('extracts the shared footer', () => {
    expect(commonDescriptionLines([ep(5), ep(4), ep(3)])).toBe(FOOTER.join('\n'));
  });

  it('needs at least 2 descriptions', () => {
    expect(commonDescriptionLines([ep(1)])).toBeNull();
    expect(commonDescriptionLines([])).toBeNull();
  });

  it('returns null when nothing is shared', () => {
    expect(commonDescriptionLines(['a\nb', 'c\nd'])).toBeNull();
    expect(commonDescriptionLines(['', ''])).toBeNull();
  });

  it('tolerates one special episode out of five (80%)', () => {
    const special = ['特別回です'].join('\n');
    expect(commonDescriptionLines([ep(5), special, ep(3), ep(2), ep(1)])).toBe(FOOTER.join('\n'));
  });

  it('does not take lines shared by only some of the episodes', () => {
    const guest = (n: number) => [`第${n}回`, 'ゲスト: 山田', ...FOOTER].join('\n');
    expect(commonDescriptionLines([guest(5), guest(4), guest(3), ep(2), ep(1)])).toBe(
      FOOTER.join('\n'),
    );
  });

  it('requires every episode when there are only 2 or 3', () => {
    expect(commonDescriptionLines([ep(2), 'other'])).toBeNull();
    expect(commonDescriptionLines([ep(3), ep(2), 'other'])).toBeNull();
  });

  it('keeps blank lines between groups as in the episode, and only one', () => {
    const d = (n: number) =>
      [
        `第${n}回`,
        '',
        '',
        'お便り: https://forms.example.com',
        `今回の BGM: 曲${n}`,
        '',
        '',
        '#番組',
      ].join('\n');
    expect(commonDescriptionLines([d(3), d(2), d(1)])).toBe(
      ['お便り: https://forms.example.com', '', '#番組'].join('\n'),
    );
  });

  it('joins lines that were only separated by a non-shared line', () => {
    const d = (n: number) => ['お便り', `ゲスト ${n}`, 'X: @show'].join('\n');
    expect(commonDescriptionLines([d(2), d(1)])).toBe('お便り\nX: @show');
  });

  it('uses the newest episode that has the most shared lines for order and text', () => {
    // 最新の回は定型を一部省いた。並びと文字は、定型をすべて含む次の回のものを使う
    const newest = ['第5回', 'X:  @show #番組'].join('\n');
    expect(commonDescriptionLines([newest, ep(4), ep(3), ep(2), ep(1)])).toBe(FOOTER.join('\n'));
    // 同数なら新しい回の文字（空白の違い）を使う
    const a = 'Ｘ: @show';
    const b = 'X: @show';
    expect(commonDescriptionLines([a, b])).toBe(a);
  });

  it('counts a line once per episode even when it repeats', () => {
    const d = 'X: @show\nX: @show';
    expect(commonDescriptionLines([d, 'other'])).toBeNull();
    // 出力は元の回の並びのまま（繰り返しも残す）
    expect(commonDescriptionLines([d, 'X: @show'])).toBe('X: @show\nX: @show');
  });

  it('works on HTML descriptions', () => {
    const html = (n: number) =>
      `<p>第${n}回の話</p><p>お便りは<a href="https://forms.example.com">こちら</a></p><ul><li>X: @show</li></ul>`;
    expect(commonDescriptionLines([html(3), html(2), html(1)])).toBe('お便りはこちら\n・X: @show');
  });
});

describe('suggestDescriptionTemplate', () => {
  it('suggests the shared lines of the latest episodes', () => {
    const items = [1, 2, 3].map((n) => ({ description: ep(n), publishedAt: n }));
    expect(suggestDescriptionTemplate(items)).toBe(FOOTER.join('\n'));
  });

  it('ignores old episodes whose footer differs', () => {
    const old = ['旧フォーム', '#旧番組'];
    const items = [
      ...[1, 2, 3, 4, 5].map((n) => ({ description: ep(n, old), publishedAt: n })),
      ...[6, 7, 8, 9, 10].map((n) => ({ description: ep(n), publishedAt: n })),
    ];
    expect(suggestDescriptionTemplate(items)).toBe(FOOTER.join('\n'));
  });

  it('returns null without enough episodes', () => {
    expect(suggestDescriptionTemplate([])).toBeNull();
    expect(suggestDescriptionTemplate([{ description: ep(1), publishedAt: 1 }])).toBeNull();
  });
});

describe('isUntouchedTemplate', () => {
  const seeds = ['――――――\nPodcast: {{show_name}}', '――――――\nPodcast: {{show_name}} (en)'];
  it('is true for an empty or missing template', () => {
    expect(isUntouchedTemplate('', seeds)).toBe(true);
    expect(isUntouchedTemplate('  \n', seeds)).toBe(true);
    expect(isUntouchedTemplate(null, seeds)).toBe(true);
  });
  it('is true for any language’s initial template, ignoring surrounding blank lines', () => {
    expect(isUntouchedTemplate(seeds[0]!, seeds)).toBe(true);
    expect(isUntouchedTemplate(`${seeds[1]!}\n`, seeds)).toBe(true);
  });
  it('is false for a template the user wrote', () => {
    expect(isUntouchedTemplate(`${seeds[0]!}\nお便り`, seeds)).toBe(false);
  });
});
