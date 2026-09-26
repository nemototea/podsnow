import { useLocalSearchParams } from 'expo-router';

import { useServices } from '@/features/app/ServicesProvider';
import { ASSET_KIND_ORDER } from '@/features/show/assetKinds';
import { AssetsSection } from '@/features/show/AssetsSection';
import { useT } from '@/i18n';
import type { AssetKind } from '@/infra/db/repositories/assetsRepo';
import { Screen, Toast } from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useToast } from '@/ui/useToast';

function isAssetKind(value: string | undefined): value is AssetKind {
  return !!value && ASSET_KIND_ORDER.some((kind) => kind === value);
}

/** 素材の登録・試聴・並べ替えをまとめた、番組設定の子画面（FR-SHOW-5）。 */
export default function ShowAssetsScreen() {
  const t = useT();
  const services = useServices();
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const requestedKind = typeof params.kind === 'string' ? params.kind : undefined;
  const initialKind = isAssetKind(requestedKind) ? requestedKind : undefined;
  const { toast, show, act, dismiss } = useToast();

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <ScreenHeader title={t.showAssets.title} subtitle={services.show.name} />
      <AssetsSection
        {...(initialKind ? { initialKind } : {})}
        onToast={(text, undo) =>
          show(undo ? { text, action: t.common.undo, onAction: undo } : { text })
        }
      />
    </Screen>
  );
}
