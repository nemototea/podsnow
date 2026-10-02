import {
  applyDetailsPatch,
  detailsPatch,
  draftFromEpisode,
  fromDateInput,
  toDateInput,
} from '../detailsDraft';

const saved = {
  title: '題',
  description: '概要',
  episode_number: 3,
  season: 1,
  recorded_at: new Date(2026, 8, 23, 10, 30).getTime(),
};

describe('detailsDraft', () => {
  it('変わっていなければ保存しない', () => {
    expect(detailsPatch(draftFromEpisode(saved), saved)).toBeNull();
  });

  it('変わった項目だけを返す。タイトルは前後の空白を除く', () => {
    const d = { ...draftFromEpisode(saved), title: '  新しい題 ', season: '2' };
    expect(detailsPatch(d, saved)).toEqual({ title: '新しい題', season: 2 });
  });

  it('時刻つきの収録日でも、日付が同じなら保存しない', () => {
    const d = { ...draftFromEpisode(saved), recordedAt: '2026-09-23' };
    expect(detailsPatch(d, saved)).toBeNull();
  });

  it('収録日を変えた・消したときは保存する', () => {
    expect(detailsPatch({ ...draftFromEpisode(saved), recordedAt: '2026-09-24' }, saved)).toEqual({
      recordedAt: new Date(2026, 8, 24).getTime(),
    });
    expect(detailsPatch({ ...draftFromEpisode(saved), recordedAt: '' }, saved)).toEqual({
      recordedAt: null,
    });
  });

  it('読めない値はその項目だけ保存しない', () => {
    const d = {
      ...draftFromEpisode(saved),
      episodeNumber: '',
      season: '0',
      recordedAt: '2026-02-31',
      description: '新しい概要',
    };
    expect(detailsPatch(d, saved)).toEqual({ description: '新しい概要' });
  });

  it('保存した差分を手元の値に反映すると、次の差分は空になる', () => {
    const d = { ...draftFromEpisode(saved), title: 'x', episodeNumber: '4', recordedAt: '' };
    const patch = detailsPatch(d, saved)!;
    expect(detailsPatch(d, applyDetailsPatch(saved, patch))).toBeNull();
  });

  it('日付の文字列と相互に変換できる', () => {
    expect(toDateInput(null)).toBe('');
    expect(fromDateInput(' ')).toBeNull();
    expect(fromDateInput('2026-9-3')).toBe(new Date(2026, 8, 3).getTime());
    expect(fromDateInput('2026/09/03')).toBeUndefined();
    expect(toDateInput(fromDateInput('2026-09-03')!)).toBe('2026-09-03');
  });
});
