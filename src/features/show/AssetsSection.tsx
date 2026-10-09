import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/list';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { ASSET_KIND_ORDER, assetKinds, kindLabel } from '@/features/show/assetKinds';
import { useAssetPreview } from '@/features/show/useAssetPreview';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT } from '@/i18n';
import type { AssetKind, AssetRow } from '@/infra/db/repositories/assetsRepo';
import { space, typography } from '@/ui/tokens';
import { Button, Card, Chip, Field, IconButton, ProgressBar, Row, Text } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { confirmDestructive } from '@/ui/alerts';
import { ReorderList } from '@/ui/ReorderList';
import { MoreMenu } from '@/ui/MoreMenu';
import { useAppTheme } from '@/ui/ThemeContext';

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

export interface AssetsSectionProps {
  /** 既定構成の選択シートから来たときに、対象の用途を最初から開く。 */
  initialKind?: AssetKind;
  /** 取り込み・削除の結果を伝える。取り消しがあるものは onAction を渡す。 */
  onToast: (text: string, undo?: () => void | Promise<void>) => void;
}

/**
 * 素材（FR-AST-1〜3）: 用途別の一覧、取り込み、試聴、お気に入り、並び替え、名前変更、削除。
 * 番組設定から 1 タップで開く素材管理画面の本体（docs/ux-restructure.md §8）。
 */
export function AssetsSection({ initialKind, onToast }: AssetsSectionProps) {
  const c = useAppTheme();
  const t = useT();
  const { assets, show, engine, db, now, haptics } = useServices();
  const loader = useCallback(() => assets.list(show.id), [assets, show.id]);
  const { data: list, reload } = useAsyncData<AssetRow[]>(loader, []);
  // 既定は「すべて」で、用途ごとのまとまりを順に並べる。どこに何を足せばよいかを一度に見せる
  // （ユーザー判断 2026-10-09）。Home のタイルなどから用途を指定して来たら、その用途だけを見せる。
  const [filter, setFilter] = useState<AssetKind | 'all'>(initialKind ?? 'all');
  const [renaming, setRenaming] = useState<AssetRow | null>(null);
  const [renameText, setRenameText] = useState('');
  const [importing, setImporting] = useState<{ kind: AssetKind; progress: number } | null>(null);
  // 試聴は PlaybackService を通す（ほかの再生を止め、再生用の音声モードを当てる。Issue #174）
  const { playingId, toggle: preview, stop: stopPreview } = useAssetPreview();

  useEffect(() => {
    const sub = engine.on('onTaskProgress', (e) => {
      if (e.task === 'import') setImporting((s) => (s ? { ...s, progress: e.progress } : s));
    });
    return () => sub.remove();
  }, [engine]);

  const pick = async (kind: AssetKind) => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const file = res.assets[0];
    const name = (file.name ?? 'audio').replace(/\.[^.]+$/, '');
    setImporting({ kind, progress: 0 });
    try {
      await assets.import(show.id, kind, stripScheme(file.uri), name, file.name ?? null);
      await reload();
      onToast(t.showAssets.imported(kindLabel(t, kind), name));
    } catch (e) {
      onToast(t.showAssets.importFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(null);
    }
  };

  const toggleFavorite = async (a: AssetRow) => {
    await assets.setFavorite(a.id, !a.is_favorite);
    await reload();
  };

  /** 同じ種類の中で並べ替える（ドラッグ）。並びは種類ごとに持つ。 */
  const move = async (items: readonly AssetRow[], from: number, to: number) => {
    await assets.reorder(moveItem(items, from, to).map((x) => x.id));
    await reload();
  };

  const confirmRemove = (a: AssetRow) =>
    confirmDestructive({
      title: t.showAssets.confirmRemove(a.name),
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      onConfirm: () => void remove(a),
    });

  const remove = async (a: AssetRow) => {
    if (playingId === a.id) stopPreview();
    await assets.remove(a.id);
    await reload();
    onToast(t.showAssets.removed(a.name), async () => {
      await db.run('UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ?', [
        now(),
        a.id,
      ]);
      await reload();
    });
  };

  const startRename = (a: AssetRow) => {
    setRenameText(a.name);
    setRenaming(a);
  };

  const commitRename = async () => {
    if (!renaming) return;
    const name = renameText.trim();
    if (name) await assets.rename(renaming.id, name);
    setRenaming(null);
    await reload();
  };

  /** 用途ごとのまとまり（見出し・説明・一覧・追加の行）。 */
  const renderKind = (k: AssetKind) => {
    const items = list.filter((a) => a.kind === k);
    const label = kindLabel(t, k);
    return (
      <View key={k} style={st.kindSection}>
        <View style={st.kindHead}>
          <Text
            style={[typography.subheading, st.flex, { color: c.textPrimary }]}
            accessibilityRole="header"
          >
            {label}
          </Text>
          {items.length ? (
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.showAssets.count(items.length)}
            </Text>
          ) : null}
        </View>
        <Text style={[typography.caption, { color: c.textSecondary }]}>{t.assetKinds[k].hint}</Text>
        <Card style={st.group}>
          {items.length ? (
            <ReorderList
              items={items}
              keyOf={(a) => a.id}
              labelOf={(a) => a.name}
              onMove={(from, to) => move(items, from, to)}
              onPick={() => haptics.play('light')}
              onCross={() => haptics.play('selection')}
              renderItem={(a, _i, { grip, a11y }) => (
                <Row
                  label={a.name}
                  sub={
                    a.default_gain_db
                      ? `${formatSmp(smp(a.duration_smp))} · ${a.default_gain_db > 0 ? '+' : ''}${a.default_gain_db} dB`
                      : formatSmp(smp(a.duration_smp))
                  }
                  {...a11y}
                  right={
                    <View style={st.rowRight}>
                      <IconButton
                        name={playingId === a.id ? 'stop' : 'play'}
                        label={playingId === a.id ? t.showAssets.stop : t.showAssets.preview}
                        selected={playingId === a.id}
                        onPress={() => void preview(a)}
                      />
                      <IconButton
                        name={a.is_favorite ? 'starFilled' : 'star'}
                        label={a.is_favorite ? t.showAssets.unfavorite : t.showAssets.favorite}
                        color={a.is_favorite ? c.accentText : c.textSecondary}
                        selected={!!a.is_favorite}
                        onPress={() => void toggleFavorite(a)}
                      />
                      <MoreMenu
                        label={t.showAssets.a11yMenu(a.name)}
                        title={`${a.name} · ${label}`}
                        actions={[
                          {
                            key: 'rename',
                            icon: 'edit',
                            label: t.common.rename,
                            onPress: () => startRename(a),
                          },
                          {
                            key: 'remove',
                            icon: 'trash',
                            label: t.common.delete,
                            destructive: true,
                            onPress: () => confirmRemove(a),
                          },
                        ]}
                      />
                      {grip}
                    </View>
                  }
                />
              )}
            />
          ) : null}
          {importing?.kind === k ? (
            <View style={st.progressWrap}>
              <ProgressBar
                value={importing.progress}
                label={t.showAssets.importing(Math.round(importing.progress * 100))}
              />
            </View>
          ) : (
            // 追加はその用途の一覧の最後に置く（入る場所で足す。ユーザー判断 2026-10-09）
            <Row
              icon="plus"
              label={t.showAssets.addKind(label)}
              sub={t.showAssets.addKindSub}
              accessibilityLabel={t.showAssets.a11yAdd(label)}
              onPress={() => {
                if (!importing) void pick(k);
              }}
              last
            />
          )}
        </Card>
      </View>
    );
  };

  const shown = filter === 'all' ? ASSET_KIND_ORDER : [filter];

  return (
    <>
      {/* 用途の絞り込み。「すべて」は用途ごとのまとまりを順に並べる */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.kinds}
      >
        <Chip label={t.showAssets.all} active={filter === 'all'} onPress={() => setFilter('all')} />
        {assetKinds(t).map((k) => {
          const n = list.filter((a) => a.kind === k.kind).length;
          return (
            <Chip
              key={k.kind}
              label={n ? `${k.label} ${n}` : k.label}
              active={filter === k.kind}
              onPress={() => setFilter(k.kind)}
            />
          );
        })}
      </ScrollView>

      <View style={st.sections}>{shown.map(renderKind)}</View>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)} title={t.common.rename}>
        <Field
          label={t.showAssets.a11yAssetName}
          value={renameText}
          onChangeText={setRenameText}
          autoFocus
          onSubmitEditing={() => void commitRename()}
          returnKeyType="done"
        />
        <Button label={t.common.save} onPress={() => void commitRename()} />
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  kinds: { gap: space.sm },
  // 用途のまとまりの間 22（Home のまとまりの間と同じ）。見出し・説明・一覧の間 6。
  sections: { marginTop: space.x22, gap: space.x22 },
  kindSection: { gap: space.x6 },
  kindHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  group: { paddingVertical: space.xs, marginTop: space.x6 },
  rowRight: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
  progressWrap: { paddingVertical: space.md, paddingHorizontal: space.md, gap: space.sm },
});
