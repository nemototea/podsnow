import { asAppErrorCode, isAppError, type AppError, type AppErrorCode } from '@/domain/errors';

import type { Messages } from './types';

/**
 * `AppErrorCode` を表示文言にする（Issue #80）。
 *
 * カタログ側は引数を取るものと取らないものが混ざるので、
 * 差し込みが必要なコードだけここで明示的に組み立てる。
 * コードを増やすと switch の網羅性チェックでここが落ちる。
 */
export function errorCodeText(
  t: Messages,
  code: AppErrorCode,
  params: Readonly<Record<string, string | number>> = {},
): string {
  switch (code) {
    case 'backup_unsupported_version':
      return t.errors.backup_unsupported_version(String(params.version ?? ''));
    case 'disk_space_insufficient':
      return t.errors.disk_space_insufficient(
        String(params.requiredMb ?? '?'),
        String(params.availableMb ?? '?'),
      );
    case 'import_http_status':
      return t.errors.import_http_status(String(params.status ?? '?'));
    case 'import_too_large':
      return t.errors.import_too_large(String(params.maxMb ?? '?'));
    case 'voice_timeline_empty':
    case 'backup_manifest_missing':
    case 'recording_resume_failed':
    case 'export_app_terminated':
    case 'export_not_in_backup':
    case 'export_cancelled_on_restore':
    case 'import_not_https':
    case 'import_network_failed':
    case 'import_timeout':
    case 'import_not_a_feed':
    case 'import_no_feed_url':
      return t.errors[code];
  }
}

/** 例外を表示文言にする。`AppError` 以外はそのままメッセージを出す。 */
export function errorText(t: Messages, e: unknown): string {
  if (isAppError(e)) return errorCodeText(t, e.code, (e as AppError).params);
  return e instanceof Error ? e.message : String(e);
}

/**
 * DB の `error` 列など「コードか、昔の日本語文言か」が入っている値を表示文言にする。
 * コードとして解釈できないものはそのまま返す（既存の行との互換）。
 */
export function storedErrorText(t: Messages, value: string | null | undefined): string {
  const code = asAppErrorCode(value);
  return code ? errorCodeText(t, code) : (value ?? '');
}
