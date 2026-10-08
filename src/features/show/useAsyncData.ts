import { useCallback, useEffect, useState } from 'react';

/**
 * 非同期ロードの小さな共通フック。effect 内で同期 setState しない（React Compiler lint 対応）。
 * loader は依存が変わるたびに再実行される。
 */
export function useAsyncData<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const v = await loader();
    setData(v);
    setLoading(false);
  }, [loader]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(async () => {
      if (!alive) return;
      const v = await loader();
      if (!alive) return;
      setData(v);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [loader]);
  return { data, loading, reload, setData };
}
