import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useT, type Messages } from '@/i18n';
import { bootstrap, type AppServices } from '@/services/app/container';
import type { ServiceLabels } from '@/services/app/labels';

const Ctx = createContext<AppServices | null>(null);

/** カタログから、DB に書き込む既定文言だけを取り出す（Issue #80、FR-I18N-6）。 */
function serviceLabels(t: Messages): ServiceLabels {
  return {
    showName: t.seed.showName,
    descriptionTemplate: t.seed.descriptionTemplate,
    takeName: t.seed.takeName,
    addTakeOp: t.seed.addTakeOp,
    interruptionNote: t.seed.interruptionNote,
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
  // ここは設定を読む前なので端末ロケールのカタログが入る。
  // 初回起動時の Show / 概要欄テンプレートはその言語で作られる。
  const t = useT();
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    bootstrap(serviceLabels(t))
      .then((s) => alive && setServices(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // bootstrap は 1 回だけ。以後の言語変更は ServiceLabelsSync が反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) throw new Error(`起動に失敗しました: ${error}`);
  if (!services) return <>{fallback}</>;
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

/**
 * 表示言語が変わったら、これから DB に書き込む既定文言も切り替える（FR-I18N-6）。
 *
 * **設定で選んだ言語を見ている `LocaleProvider` の内側**に置く必要がある。
 * `ServicesProvider` 自身はその外（端末ロケールを見る側）にいるので、
 * 設定で言語を上書きしたときの反映はここで行う。書き込み済みの行は触らない。
 */
export function ServiceLabelsSync() {
  const services = useServices();
  const t = useT();
  useEffect(() => {
    services.setLabels(serviceLabels(t));
  }, [services, t]);
  return null;
}

export function useServices(): AppServices {
  const s = useContext(Ctx);
  if (!s) throw new Error('ServicesProvider の外で useServices が呼ばれました');
  return s;
}
