import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useT } from '@/i18n';
import type { ServiceLabels } from '@/services/app/labels';
import { bootstrap, type AppServices } from '@/services/app/container';

const Ctx = createContext<AppServices | null>(null);

/** カタログから、DB に書き込む既定文言だけを取り出す（Issue #80）。 */
function serviceLabels(t: ReturnType<typeof useT>): ServiceLabels {
  return {
    showName: t.seed.showName,
    descriptionTemplate: t.seed.descriptionTemplate,
    episodeTitle: t.seed.episodeTitle,
    takeName: t.seed.takeName,
    interruptionMarker: t.seed.interruptionMarker,
    androidNotification: t.androidNotification,
  };
}

export function ServicesProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const t = useT();
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // 初回起動時の Show / テンプレートは、その時点の表示言語で作る。
    bootstrap(serviceLabels(t))
      .then((s) => alive && setServices(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // bootstrap は 1 回だけ。言語変更は下の effect で反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 言語を切り替えたら、これから書き込む既定文言も切り替える。
  useEffect(() => {
    services?.setLabels(serviceLabels(t));
  }, [services, t]);
  if (error) throw new Error(`起動に失敗しました: ${error}`);
  if (!services) return <>{fallback}</>;
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(Ctx);
  if (!s) throw new Error('ServicesProvider の外で useServices が呼ばれました');
  return s;
}
