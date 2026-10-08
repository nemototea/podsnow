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
  episode_number: 3 as number | null,
  season: 1 as number | null,
  episode_type: 'full' as const,
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
      episodeNumber: 'abc',
      season: '-1',
      recordedAt: '2026-02-31',
      description: '新しい概要',
    };
    expect(detailsPatch(d, saved)).toEqual({ description: '新しい概要' });
  });

  it('話数・シーズンは空か 0 なら空として保存する（Issue #211）', () => {
    expect(
      detailsPatch({ ...draftFromEpisode(saved), episodeNumber: '', season: '0' }, saved),
    ).toEqual({ episodeNumber: null, season: null });
  });

  it('空の話数・シーズンは空文字の欄になり、触らなければ保存しない', () => {
    const none = { ...saved, episode_number: null, season: null };
    const d = draftFromEpisode(none);
    expect(d).toMatchObject({ episodeNumber: '', season: '' });
    expect(detailsPatch(d, none)).toBeNull();
    expect(detailsPatch({ ...d, episodeNumber: '0' }, none)).toBeNull();
    expect(detailsPatch({ ...d, season: '2' }, none)).toEqual({ season: 2 });
  });

  it('エピソードの種類を変えたら保存する', () => {
    const d = { ...draftFromEpisode(saved), episodeType: 'bonus' as const };
    const patch = detailsPatch(d, saved);
    expect(patch).toEqual({ episodeType: 'bonus' });
    expect(detailsPatch(d, applyDetailsPatch(saved, patch!))).toBeNull();
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
