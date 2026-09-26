/**
 * ユーザーに見せるエラーの安定コード（Issue #80）。
 *
 * メッセージ自体は表示する側（UI 層の `src/i18n/`）で組み立てる。
 * domain / services / infra は文言を持たず、コードだけを返す。
 *
 * コードは DB（`exports.error` など）にも入るので、**値は変えない**。
 */
export const APP_ERROR_CODES = [
  /** 声トラックが空のまま書き出そうとした */
  'voice_timeline_empty',
  /** 割り込みからの録音再開に失敗した */
  'recording_resume_failed',
  /** 想定収録時間に対して空き容量が足りない（params: requiredMb, availableMb） */
  'disk_space_insufficient',
  /** 書き出し中にアプリが終了したため中断扱いにした */
  'export_app_terminated',
  /** 取り込み: HTTPS 以外の URL（リダイレクト先を含む） */
  'import_not_https',
  /** 取り込み: 通信できなかった */
  'import_network_failed',
  /** 取り込み: 時間内に応答が無かった */
  'import_timeout',
  /** 取り込み: 応答が 2xx 以外（params: status） */
  'import_http_status',
  /** 取り込み: 応答が大きすぎる（params: maxMb） */
  'import_too_large',
  /** 取り込み: RSS として読めない */
  'import_not_a_feed',
  /** 取り込み: 検索結果に RSS の URL が無い */
  'import_no_feed_url',
  /** 取り込み: 今の番組とは別の番組（番組を 1 つしか持てない間は取り込めない） */
  'import_other_show',
  /** 取り込み: UTF-8 以外の文字コードの RSS（params: encoding） */
  'import_unsupported_encoding',
  /** 番組アートワークの正規化または保存に失敗した */
  'cover_processing_failed',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

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

const CODES: ReadonlySet<string> = new Set(APP_ERROR_CODES);

/**
 * DB に保存された値が `AppErrorCode` かどうか。
 * 古い行には日本語の文言がそのまま入っているので、その場合は `null` を返す。
 */
export function asAppErrorCode(value: string | null | undefined): AppErrorCode | null {
  return value && CODES.has(value) ? (value as AppErrorCode) : null;
}
