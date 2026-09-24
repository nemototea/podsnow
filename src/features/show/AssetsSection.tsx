import * as DocumentPicker from 'expo-document-picker';
import { useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { ASSET_KIND_ORDER, assetKinds, kindLabel } from '@/features/show/assetKinds';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT } from '@/i18n';
import type { AssetKind, AssetRow } from '@/infra/db/repositories/assetsRepo';
import { joinRoot } from '@/infra/files/layout';
import { space } from '@/ui/tokens';
import {
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  ProgressBar,
  Row,
  SectionHeader,
  Sheet,
} from '@/ui/components';
import { iosPrompt } from '@/ui/alerts';
import { MoreMenu } from '@/ui/MoreMenu';
import { useAppTheme } from '@/ui/ThemeContext';

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

export interface AssetsSectionProps {
  /** 取り込み・削除の結果を伝える。取り消しがあるものは onAction を渡す。 */
  onToast: (text: string, undo?: () => void | Promise<void>) => void;
}

/**
 * 素材（FR-AST-1〜3）: 用途別の一覧、取り込み、試聴、お気に入り、並び替え、名前変更、削除。
 * 番組画面の 1 セクションとして置く（画面を分けない。docs/ux-restructure.md §8）。
 */
export function AssetsSection({ onToast }: AssetsSectionProps) {
  const c = useAppTheme();
  const t = useT();
  const { assets, show, root, engine, db, now } = useServices();
  const loader = useCallback(() => assets.list(show.id), [assets, show.id]);
  const { data: list, reload } = useAsyncData<AssetRow[]>(loader, []);
  // 用途は切り替え式。空の用途が画面を占めない（DESIGN_SYSTEM.md §2.3）。
  const [kind, setKind] = useState<AssetKind>(ASSET_KIND_ORDER[0]!);
  const [renaming, setRenaming] = useState<AssetRow | null>(null);
  const [renameText, setRenameText] = useState('');
  const [importing, setImporting] = useState<{ kind: AssetKind; progress: number } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // 試聴プレイヤー（expo-audio）。1 つを使い回し、ソースを差し替える。
  const player = useAudioPlayer(null);

  useEffect(() => {
    const sub = engine.on('onTaskProgress', (e) => {
      if (e.task === 'import') setImporting((s) => (s ? { ...s, progress: e.progress } : s));
    });
    return () => sub.remove();
  }, [engine]);

  const preview = (a: AssetRow) => {
    if (playingId === a.id) {
      player.pause();
      setPlayingId(null);
      return;
    }
    player.replace({ uri: `file://${joinRoot(root, a.path)}` });
    player.seekTo(0);
    player.play();
    setPlayingId(a.id);
  };

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

  const move = async (a: AssetRow, dir: -1 | 1) => {
    const group = list.filter((x) => x.kind === a.kind);
    const i = group.findIndex((x) => x.id === a.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const ids = group.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await assets.reorder(ids);
    await reload();
  };

  const remove = async (a: AssetRow) => {
    if (playingId === a.id) {
      player.pause();
      setPlayingId(null);
    }
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
    const shown = iosPrompt({
      title: t.common.rename,
      defaultValue: a.name,
      confirmLabel: t.common.save,
      cancelLabel: t.common.cancel,
      onConfirm: (text) => {
        const name = text.trim();
        if (name) void assets.rename(a.id, name).then(reload);
      },
    });
    if (shown) return;
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

  const items = list.filter((a) => a.kind === kind);

  return (
    <>
      <SectionHeader
        title={t.showAssets.title}
        right={
          <View style={st.addWrap}>
            <IconButton
              name="plus"
              label={t.showAssets.a11yAdd(kindLabel(t, kind))}
              disabled={!!importing}
              onPress={() => void pick(kind)}
            />
          </View>
        }
      />
      <View style={st.kinds}>
        {assetKinds(t).map((k) => {
          const n = list.filter((a) => a.kind === k.kind).length;
          return (
            <Chip
              key={k.kind}
              label={n ? `${k.label} ${n}` : k.label}
              active={kind === k.kind}
              onPress={() => setKind(k.kind)}
            />
          );
        })}
      </View>

      {importing?.kind === kind ? (
        <View style={st.progressWrap}>
          <ProgressBar
            value={importing.progress}
            label={t.showAssets.importing(Math.round(importing.progress * 100))}
          />
        </View>
      ) : null}
      {items.length ? (
        <Card style={st.group}>
          {items.map((a, i) => (
            <Row
              key={a.id}
              label={a.name}
              sub={
                a.default_gain_db
                  ? `${formatSmp(smp(a.duration_smp))} · ${a.default_gain_db > 0 ? '+' : ''}${a.default_gain_db} dB`
                  : formatSmp(smp(a.duration_smp))
              }
              last={i === items.length - 1}
              right={
                <View style={st.rowRight}>
                  <IconButton
                    name={playingId === a.id ? 'stop' : 'play'}
                    label={playingId === a.id ? t.showAssets.stop : t.showAssets.preview}
                    selected={playingId === a.id}
                    onPress={() => preview(a)}
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
                    title={`${a.name} · ${kindLabel(t, a.kind)}`}
                    actions={[
                      {
                        key: 'rename',
                        icon: 'edit',
                        label: t.common.rename,
                        onPress: () => startRename(a),
                      },
                      {
                        key: 'up',
                        icon: 'up',
                        label: t.common.moveUp,
                        onPress: () => void move(a, -1),
                      },
                      {
                        key: 'down',
                        icon: 'down',
                        label: t.common.moveDown,
                        onPress: () => void move(a, 1),
                      },
                      {
                        key: 'remove',
                        icon: 'trash',
                        label: t.common.delete,
                        destructive: true,
                        onPress: () => void remove(a),
                      },
                    ]}
                  />
                </View>
              }
            />
          ))}
        </Card>
      ) : null}

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
  group: { paddingVertical: space.xs, marginTop: space.md },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  addWrap: { marginRight: -space.md },
  rowRight: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
  progressWrap: { paddingVertical: space.md, gap: space.sm },
});
