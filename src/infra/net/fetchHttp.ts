import { AppError } from '@/domain/errors';
import type { HttpGetOptions, HttpPort, HttpResponseMeta } from '@/services/podcast/HttpPort';

/**
 * `fetch` による HttpPort（Issue #101）。
 * 【仮説: React Native 0.86 の fetch の `AbortController` / `arrayBuffer()` は実機で要確認】
 */
async function request(
  url: string,
  opts: HttpGetOptions,
): Promise<{ res: Response; meta: HttpResponseMeta; aborted: () => boolean; done: () => void }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      ...(opts.accept ? { headers: { Accept: opts.accept } } : {}),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new AppError(ctrl.signal.aborted ? 'import_timeout' : 'import_network_failed', {}, e);
  }
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    clearTimeout(timer);
    ctrl.abort();
    throw tooLarge(opts);
  }
  return {
    res,
    meta: {
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
    },
    aborted: () => ctrl.signal.aborted,
    done: () => clearTimeout(timer),
  };
}

function tooLarge(opts: HttpGetOptions): AppError {
  return new AppError('import_too_large', {
    maxMb: Math.round(opts.maxBytes / (1024 * 1024)),
  });
}

async function readBody<T>(read: () => Promise<T>, aborted: () => boolean): Promise<T> {
  try {
    return await read();
  } catch (e) {
    throw new AppError(aborted() ? 'import_timeout' : 'import_network_failed', {}, e);
  }
}

export const fetchHttp: HttpPort = {
  async getText(url, opts) {
    const { res, meta, aborted, done } = await request(url, opts);
    try {
      // Content-Length が無い応答もあるので、読んだあとにも測る（UTF-16 の長さで近似）
      const text = await readBody(() => res.text(), aborted);
      if (text.length > opts.maxBytes) throw tooLarge(opts);
      return { ...meta, text };
    } finally {
      done();
    }
  },
  async getBytes(url, opts) {
    const { res, meta, aborted, done } = await request(url, opts);
    try {
      const buf = await readBody(() => res.arrayBuffer(), aborted);
      if (buf.byteLength > opts.maxBytes) throw tooLarge(opts);
      return { ...meta, bytes: new Uint8Array(buf) };
    } finally {
      done();
    }
  },
};
