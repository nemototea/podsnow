import { formatAllMetadata, insertTopics, renderTemplate } from '../template';

describe('renderTemplate', () => {
  it('expands known variables and keeps unknown ones', () => {
    const out = renderTemplate(
      '{{title}} #{{episode_number}} S{{season}}\n{{topics}}\n{{show_name}} {{nope}}',
      {
        title: 'T',
        episodeNumber: 24,
        season: 2,
        topics: ['a', ' b ', ''],
        showName: 'S',
      },
    );
    expect(out).toBe('T #24 S2\n・a\n・b\nS {{nope}}');
  });

  const empty = { title: 'T', episodeNumber: 1, season: 1, topics: [], showName: 'S' };

  it('トークテーマが空なら、その行を消して先頭・末尾に空行を残さない（Issue #167）', () => {
    expect(renderTemplate('{{topics}}\n\n本文\n\n{{topics}}\n', empty)).toBe('本文');
  });

  it('消した行の上下が空行なら、空行を 1 つにまとめる', () => {
    expect(renderTemplate('前\n\n{{topics}}\n\n後', empty)).toBe('前\n\n後');
    expect(renderTemplate('前\n{{topics}}\n後', empty)).toBe('前\n後');
  });

  it('ユーザーが入れた空行は何行でも残す', () => {
    expect(renderTemplate('一\n\n\n\n二\n\n\n{{title}}', empty)).toBe('一\n\n\n\n二\n\n\nT');
    // 上に 2 行・下に 2 行の空行で間の行が消えたときは、継ぎ目の 1 行だけまとめて 3 行にする
    expect(renderTemplate('一\n\n\n{{topics}}\n\n\n二', empty)).toBe('一\n\n\n\n二');
  });

  it('未知の変数だけの行や、空でない変数の行は消さない', () => {
    expect(renderTemplate('{{nope}}\n{{title}}', empty)).toBe('{{nope}}\nT');
  });
});

describe('insertTopics', () => {
  it('replaces an existing bullet block', () => {
    expect(insertTopics('intro\n・x\n・y\n\nfooter', ['p', 'q'])).toBe('intro\n・p\n・q\n\nfooter');
  });
  it('appends when there is no bullet block', () => {
    expect(insertTopics('intro', ['p'])).toBe('intro\n\n・p');
    expect(insertTopics('', ['p'])).toBe('・p');
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
});
