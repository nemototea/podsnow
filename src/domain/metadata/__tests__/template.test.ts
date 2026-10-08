import {
  formatAllMetadata,
  insertAtSelection,
  previewTemplate,
  renderTemplate,
  TEMPLATE_VARS,
} from '../template';

describe('renderTemplate', () => {
  it('expands known variables and keeps unknown ones', () => {
    const out = renderTemplate(
      '{{title}} #{{episode_number}} S{{season}}\n{{show_name}} {{nope}}',
      {
        title: 'T',
        episodeNumber: 24,
        season: 2,
        showName: 'S',
      },
    );
    expect(out).toBe('T #24 S2\nS {{nope}}');
  });

  // 行ごと消える変数の例として、空のシーズンを使う
  const empty = { title: 'T', episodeNumber: 1, season: null, showName: 'S' };

  it('変数が空になった行を消し、先頭・末尾に空行を残さない（Issue #167）', () => {
    expect(renderTemplate('{{season}}\n\n本文\n\n{{season}}\n', empty)).toBe('本文');
  });

  it('消した行の上下が空行なら、空行を 1 つにまとめる', () => {
    expect(renderTemplate('前\n\n{{season}}\n\n後', empty)).toBe('前\n\n後');
    expect(renderTemplate('前\n{{season}}\n後', empty)).toBe('前\n後');
  });

  it('ユーザーが入れた空行は何行でも残す', () => {
    expect(renderTemplate('一\n\n\n\n二\n\n\n{{title}}', empty)).toBe('一\n\n\n\n二\n\n\nT');
    // 上に 2 行・下に 2 行の空行で間の行が消えたときは、継ぎ目の 1 行だけまとめて 3 行にする
    expect(renderTemplate('一\n\n\n{{season}}\n\n\n二', empty)).toBe('一\n\n\n\n二');
  });

  it('話数・シーズンが空なら空文字にし、それだけの行は消す（Issue #211）', () => {
    const none = { ...empty, episodeNumber: null, season: null };
    expect(renderTemplate('#{{episode_number}} {{title}}\n{{season}}\n本文', none)).toBe(
      '# T\n本文',
    );
  });

  it('未知の変数だけの行や、空でない変数の行は消さない', () => {
    expect(renderTemplate('{{nope}}\n{{title}}', empty)).toBe('{{nope}}\nT');
  });

  it('{{topics}} は廃止した変数なので展開しない（Issue #180。既存のひな形からは移行 0010 で取り除く）', () => {
    expect(renderTemplate('{{topics}}\n{{title}}', empty)).toBe('{{topics}}\nT');
  });
});

describe('formatAllMetadata', () => {
  const labels = {
    title: 'Title',
    episode: 'Episode',
    season: 'Season',
    recordedAt: 'Recorded',
    duration: 'Duration',
    file: 'File',
  };

  it('uses the labels it is given and keeps the description at the end', () => {
    const out = formatAllMetadata({
      title: 'T',
      episodeNumber: 24,
      season: 2,
      recordedAt: new Date(Date.UTC(2026, 8, 20)),
      durationLabel: '32:10',
      fileName: 'episode-024.m4a',
      description: 'desc',
      labels,
    });
    expect(out).toBe(
      [
        'Title: T',
        'Episode: #24',
        'Season: 2',
        'Recorded: 2026-09-20',
        'Duration: 32:10',
        'File: episode-024.m4a',
        '',
        'desc',
      ].join('\n'),
    );
  });

  it('omits the recording date line when there is none', () => {
    const out = formatAllMetadata({
      title: 'T',
      episodeNumber: 1,
      season: 1,
      recordedAt: null,
      durationLabel: '1:00',
      fileName: 'f.m4a',
      description: '',
      labels,
    });
    expect(out).not.toContain('Recorded');
    // 見出し 5 行 + 区切りの空行 + 空の概要。
    expect(out.split('\n')).toHaveLength(7);
  });

  it('omits the episode and season lines when they are empty (Issue #211)', () => {
    const out = formatAllMetadata({
      title: 'T',
      episodeNumber: null,
      season: null,
      recordedAt: null,
      durationLabel: '1:00',
      fileName: 'f.m4a',
      description: '',
      labels,
    });
    expect(out.split('\n')).toEqual(['Title: T', 'Duration: 1:00', 'File: f.m4a', '', '']);
  });
});

describe('insertAtSelection（Issue #174 F2）', () => {
  it('カーソル位置に入れ、カーソルを差し込んだ直後に置く', () => {
    expect(insertAtSelection('ab', { start: 1, end: 1 }, 'X')).toEqual({ text: 'aXb', cursor: 2 });
  });

  it('選択範囲は置き換える。逆向きの選択も同じ', () => {
    expect(insertAtSelection('abcd', { start: 1, end: 3 }, 'X')).toEqual({
      text: 'aXd',
      cursor: 2,
    });
    expect(insertAtSelection('abcd', { start: 3, end: 1 }, 'X')).toEqual({
      text: 'aXd',
      cursor: 2,
    });
  });

  it('選択が分からなければ末尾に足す', () => {
    expect(insertAtSelection('ab', null, 'X')).toEqual({ text: 'abX', cursor: 3 });
  });

  it('範囲外の位置は丸める（文字を消した直後に古い位置が残っていても壊さない）', () => {
    expect(insertAtSelection('ab', { start: 9, end: 12 }, 'X')).toEqual({
      text: 'abX',
      cursor: 3,
    });
    expect(insertAtSelection('ab', { start: -1, end: -1 }, 'X')).toEqual({
      text: 'Xab',
      cursor: 1,
    });
  });

  it('空の欄にも入る', () => {
    expect(insertAtSelection('', { start: 0, end: 0 }, '{{title}}')).toEqual({
      text: '{{title}}',
      cursor: 9,
    });
  });
});

describe('previewTemplate', () => {
  const names = {
    title: '[T]',
    episode_number: '[N]',
    season: '[S]',
    show_name: '[SN]',
  };

  it('既知の変数を名前に置き換え、未知の変数と行はそのまま残す', () => {
    expect(
      previewTemplate('{{show_name}} #{{ episode_number }}\n\n{{season}}\n{{nope}}', names),
    ).toBe('[SN] #[N]\n\n[S]\n{{nope}}');
  });

  it('変数の一覧は renderTemplate が展開するものと同じ', () => {
    const body = TEMPLATE_VARS.map((k) => `{{${k}}}`).join(' ');
    const out = renderTemplate(body, {
      title: 'T',
      episodeNumber: 1,
      season: 1,
      showName: 'S',
    });
    expect(out).not.toContain('{{');
  });
});
