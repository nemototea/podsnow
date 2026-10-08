import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TabHeader } from '@/features/app/TabHeader';
import { ASSET_KIND_ORDER } from '@/features/show/assetKinds';
import { AssetsSection } from '@/features/show/AssetsSection';
import { useT } from '@/i18n';
import type { AssetKind } from '@/infra/db/repositories/assetsRepo';
import { Screen, Toast } from '@/ui/components';
import { space } from '@/ui/tokens';
import { useToast } from '@/ui/useToast';

function isAssetKind(value: string | undefined): value is AssetKind {
  return !!value && ASSET_KIND_ORDER.some((kind) => kind === value);
}

/** 下部タブの「素材」（見本 `.tabs`）。番組の音の登録・試聴・並べ替え（FR-SHOW-5、FR-AST-1〜3）。 */
export default function LibraryScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const requested = typeof params.kind === 'string' ? params.kind : undefined;
  const { toast, show, act, dismiss } = useToast();
  return (
    <Screen edgeTop overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <View style={st.head}>
        <TabHeader title={t.tabs.library} />
      </View>
      <AssetsSection
        {...(isAssetKind(requested) ? { initialKind: requested } : {})}
        onToast={(text, undo) =>
          show(undo ? { text, action: t.common.undo, onAction: undo } : { text })
        }
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  // Home の上部と同じ（見本 `.home` の上 6、まとまりの間 22）
  head: { marginTop: space.x6 - space.sm, marginBottom: space.x22 },
});
