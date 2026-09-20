/**
 * ユーザーに見せるエラーの安定コード（Issue #80）。
 *
 * メッセージ自体は表示する側（UI 層の `src/i18n/`）で組み立てる。
 * domain / services / infra は文言を持たず、コードだけを返す。
 */
export type AppErrorCode =
  /** 声トラックが空のまま書き出そうとした */
  | 'voice_timeline_empty'
  /** .podsnow でないファイルを復元しようとした */
  | 'backup_manifest_missing'
  /** バックアップの formatVersion が新しすぎる */
  | 'backup_unsupported_version'
  /** 割り込みからの録音再開に失敗した */
  | 'recording_resume_failed'
  /** 書き出し中にアプリが終了したため中断扱いにした */
  | 'export_app_terminated'
  /** バックアップに音声ファイルを含めていない（復元した書き出し履歴の注記） */
  | 'export_not_in_backup'
  /** バックアップ復元時に中断扱いにした書き出し */
  | 'export_cancelled_on_restore';

/** `code` を持つエラー。UI はコードを localized message に変換する。 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  /** 文言に差し込む値（例: `{ version: 3 }`）。 */
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    code: AppErrorCode,
    params: Readonly<Record<string, string | number>> = {},
    cause?: unknown,
  ) {
    // message はログ用。UI では使わない（i18n で code から引き直す）。
    super(cause instanceof Error ? `${code}: ${cause.message}` : code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** DB に保存された値が AppErrorCode かどうか（古い行は日本語の文言が入っている）。 */
const CODES = new Set<string>([
  'voice_timeline_empty',
  'backup_manifest_missing',
  'backup_unsupported_version',
  'recording_resume_failed',
  'export_app_terminated',
  'export_not_in_backup',
  'export_cancelled_on_restore',
]);

export function asAppErrorCode(value: string | null | undefined): AppErrorCode | null {
  return value && CODES.has(value) ? (value as AppErrorCode) : null;
}
