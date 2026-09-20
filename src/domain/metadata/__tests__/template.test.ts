import { insertTopics, renderTemplate } from '../template';

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
