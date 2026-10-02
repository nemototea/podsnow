import { formatAllMetadata, insertTopics, renderTemplate, tidyBlankLines } from '../template';

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

  it('トークテーマが空でも、先頭・末尾・途中に空行を残さない（Issue #167）', () => {
    const vars = { title: 'T', episodeNumber: 1, season: 1, topics: [], showName: 'S' };
    expect(renderTemplate('{{topics}}\n\n本文\n\n{{topics}}\n', vars)).toBe('本文');
    expect(renderTemplate('前\n\n{{topics}}\n\n後', vars)).toBe('前\n\n後');
  });
});

describe('tidyBlankLines', () => {
  it('空白だけの行も空行として詰め、空行 1 行は残す', () => {
    expect(tidyBlankLines('  \na\n \n\t\n\nb\n\nc  \n\n')).toBe('a\n\nb\n\nc');
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
