import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { bootstrap, type AppServices } from '@/services/app/container';

const Ctx = createContext<AppServices | null>(null);

export function ServicesProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    bootstrap()
      .then((s) => alive && setServices(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);
  if (error) throw new Error(`起動に失敗しました: ${error}`);
  if (!services) return <>{fallback}</>;
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(Ctx);
  if (!s) throw new Error('ServicesProvider の外で useServices が呼ばれました');
  return s;
}
