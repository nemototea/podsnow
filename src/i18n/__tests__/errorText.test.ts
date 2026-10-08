import { APP_ERROR_CODES, AppError, asAppErrorCode, isAppError } from '@/domain/errors';

import { errorCodeText, errorText, storedErrorText } from '../errorText';
import { messagesFor } from '../resolve';
import { LOCALES } from '../types';

describe('errorCodeText', () => {
  it.each(LOCALES)('%s ですべてのコードが空でない文言になる', (locale) => {
    const t = messagesFor(locale);
    for (const code of APP_ERROR_CODES) {
      const text = errorCodeText(t, code, { requiredMb: 660, availableMb: 12 });
      expect(text.trim()).not.toBe('');
      // コード名がそのまま出ていない（文言の引き忘れ検知）
      expect(text).not.toBe(code);
    }
  });

  it('容量不足は理由だけを短く出す（題が「録音を始められません」なので。Issue #165）', () => {
    const t = messagesFor('ja');
    expect(errorCodeText(t, 'disk_space_insufficient')).toBe('端末の空き容量が足りません');
  });
});

describe('errorText', () => {
  const t = messagesFor('en');

  it('AppError はコードから文言を引く', () => {
    const e = new AppError('voice_timeline_empty');
    expect(isAppError(e)).toBe(true);
    expect(errorText(t, e)).toBe(t.errors.voice_timeline_empty);
  });

  it('ふつうの Error はメッセージをそのまま出す', () => {
    expect(errorText(t, new Error('boom'))).toBe('boom');
    expect(errorText(t, 'boom')).toBe('boom');
  });

  it('cause を渡してもコードから文言を引く', () => {
    const e = new AppError('recording_resume_failed', {}, new Error('native failed'));
    expect(errorText(t, e)).toBe(t.errors.recording_resume_failed);
    expect(e.message).toContain('native failed');
  });
});

describe('storedErrorText', () => {
  const t = messagesFor('ja');

  it('コードが入っていれば文言に変換する', () => {
    expect(storedErrorText(t, 'export_app_terminated')).toBe(t.errors.export_app_terminated);
  });

  it('コードでない値（古い行の日本語文言）はそのまま返す', () => {
    expect(storedErrorText(t, 'アプリが終了したため中断されました')).toBe(
      'アプリが終了したため中断されました',
    );
    expect(storedErrorText(t, null)).toBe('');
    expect(storedErrorText(t, undefined)).toBe('');
  });
});

describe('asAppErrorCode', () => {
  it('既知のコードだけを通す', () => {
    for (const code of APP_ERROR_CODES) expect(asAppErrorCode(code)).toBe(code);
    expect(asAppErrorCode('nope')).toBeNull();
    expect(asAppErrorCode('')).toBeNull();
    expect(asAppErrorCode(null)).toBeNull();
  });
});
