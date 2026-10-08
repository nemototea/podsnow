/**
 * 取り込みで使う HTTP GET の最小抽象（Issue #101、REQUIREMENTS.md NFR-10）。
 * アプリでは `fetch`（`infra/net/fetchHttp.ts`）、Jest では偽物で実装する。
 *
 * 実装は次を守る:
 * - `timeoutMs` を過ぎたら中止して `AppError('import_timeout')`
 * - 本文が `maxBytes` を超えたら `AppError('import_too_large', { maxMb })`
 * - 接続できなければ `AppError('import_network_failed')`
 * - ステータスは判定しない（呼び出し側が見る）
 *
 * HTTPS の判定は呼び出し側（PodcastImportService）が要求前とリダイレクト後の両方で行う。
 */
export interface HttpGetOptions {
  timeoutMs: number;
  maxBytes: number;
  accept?: string;
}

export interface HttpResponseMeta {
  status: number;
  /** リダイレクト後の最終 URL */
  url: string;
  contentType: string;
}

export interface HttpPort {
  getText(url: string, opts: HttpGetOptions): Promise<HttpResponseMeta & { text: string }>;
  getBytes(url: string, opts: HttpGetOptions): Promise<HttpResponseMeta & { bytes: Uint8Array }>;
}
