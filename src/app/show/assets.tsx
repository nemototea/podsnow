import * as DocumentPicker from 'expo-document-picker';
import { useAudioPlayer } from 'expo-audio';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { assetKinds, kindLabel } from '@/features/show/assetKinds';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT } from '@/i18n';
import type { AssetKind, AssetRow } from '@/infra/db/repositories/assetsRepo';
import { joinRoot } from '@/infra/files/layout';
import { Button, Card, Eyebrow, Header, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/** Show Assets（FR-AST-1〜3）: 用途別の素材一覧、取り込み、試聴、お気に入り、並び替え、名前変更、削除。 */
export default function ShowAssetsScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const { assets, show, root, engine, db, now } = useServices();
  const { toast, show: showToast, act } = useToast();
  const loader = useCallback(() => assets.list(show.id), [assets, show.id]);
  const { data: list, reload } = useAsyncData<AssetRow[]>(loader, []);
  const [menu, setMenu] = useState<AssetRow | null>(null);
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
      showToast({ text: t.showAssets.imported(kindLabel(t, kind), name) });
    } catch (e) {
      showToast({
        text: t.showAssets.importFailed(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setImporting(null);
    }
  };

  const toggleFavorite = async (a: AssetRow) => {
    await assets.setFavorite(a.id, !a.is_favorite);
    await reload();
  };

  const move = async (a: AssetRow, dir: -1 | 1) => {
    setMenu(null);
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
    setMenu(null);
    if (playingId === a.id) {
      player.pause();
      setPlayingId(null);
    }
    await assets.remove(a.id);
    await reload();
    showToast({
      text: t.showAssets.removed(a.name),
      action: t.common.undo,
      onAction: async () => {
        await db.run('UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ?', [
          now(),
          a.id,
        ]);
        await reload();
      },
    });
  };

  const startRename = (a: AssetRow) => {
    setMenu(null);
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

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} />}>
      <Header title={t.showAssets.title} subtitle={show.name} onBack={() => router.back()} />
      <Text style={[st.lead, { color: c.ink2 }]}>{t.showAssets.lead}</Text>

      {assetKinds(t).map((k) => {
        const items = list.filter((a) => a.kind === k.kind);
        const busy = importing?.kind === k.kind;
        return (
          <View key={k.kind}>
            <View style={st.groupHead}>
              <View style={{ flex: 1 }}>
                <Eyebrow>{k.label}</Eyebrow>
                <Text style={[st.groupSub, { color: c.ink3 }]}>{k.sub}</Text>
              </View>
              <Pressable
                onPress={() => pick(k.kind)}
                disabled={!!importing}
                accessibilityRole="button"
                accessibilityLabel={t.showAssets.a11yAdd(k.label)}
                hitSlop={8}
                style={{ marginTop: 18, opacity: importing ? 0.4 : 1 }}
              >
                <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>
                  {t.showAssets.add}
                </Text>
              </Pressable>
            </View>
            <Card style={{ paddingVertical: 4 }}>
              {busy ? (
                <View style={st.progressWrap}>
                  <Text style={{ color: c.ink2, fontSize: 12 }}>
                    {t.showAssets.importing(Math.round((importing?.progress ?? 0) * 100))}
                  </Text>
                  <View style={[st.progressTrack, { backgroundColor: c.panel2 }]}>
                    <View
                      style={[
                        st.progressBar,
                        {
                          backgroundColor: c.accent,
                          width: `${Math.round((importing?.progress ?? 0) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : null}
              {items.length === 0 && !busy ? (
                <Text style={{ color: c.ink3, paddingVertical: 12, fontSize: 13 }}>
                  {t.showAssets.empty}
                </Text>
              ) : null}
              {items.map((a) => (
                <Row
                  key={a.id}
                  label={a.name}
                  sub={`${formatSmp(smp(a.duration_smp))} · ${a.default_gain_db} dB`}
                  right={
                    <View style={st.rowRight}>
                      <Pressable
                        onPress={() => preview(a)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          playingId === a.id ? t.showAssets.stop : t.showAssets.preview
                        }
                        style={[
                          st.playBtn,
                          {
                            borderColor: c.line,
                            backgroundColor: playingId === a.id ? c.accent : 'transparent',
                          },
                        ]}
                      >
                        <Text
                          style={{ color: playingId === a.id ? '#141414' : c.ink, fontSize: 12 }}
                        >
                          {playingId === a.id ? '■' : '▶'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleFavorite(a)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          a.is_favorite ? t.showAssets.unfavorite : t.showAssets.favorite
                        }
                      >
                        <Text style={{ color: a.is_favorite ? c.accent : c.ink3, fontSize: 18 }}>
                          {a.is_favorite ? '★' : '☆'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setMenu(a)}
                        hitSlop={10}
                        accessibilityLabel={t.a11y.menu}
                      >
                        <Text style={{ color: c.ink2, fontSize: 18 }}>⋮</Text>
                      </Pressable>
                    </View>
                  }
                />
              ))}
            </Card>
          </View>
        );
      })}

      <Sheet
        visible={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.name ?? ''}
        subtitle={menu ? kindLabel(t, menu.kind) : ''}
      >
        {menu ? (
          <>
            <Row label={t.common.rename} onPress={() => startRename(menu)} />
            <Row label={t.common.moveUp} onPress={() => move(menu, -1)} />
            <Row label={t.common.moveDown} onPress={() => move(menu, 1)} />
            <Row
              label={menu.is_favorite ? t.showAssets.unfavorite : t.showAssets.favorite}
              onPress={() => {
                setMenu(null);
                void toggleFavorite(menu);
              }}
            />
            <Row
              label={t.common.delete}
              sub={t.showAssets.removeSub}
              danger
              onPress={() => remove(menu)}
            />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)} title={t.common.rename}>
        <TextInput
          value={renameText}
          onChangeText={setRenameText}
          autoFocus
          accessibilityLabel={t.showAssets.a11yAssetName}
          style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.panel2 }]}
          onSubmitEditing={commitRename}
          returnKeyType="done"
        />
        <Button label={t.common.save} onPress={commitRename} style={{ marginTop: 12 }} />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  lead: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  groupHead: { flexDirection: 'row', alignItems: 'flex-start' },
  groupSub: { fontSize: 11, marginTop: -4, marginBottom: 8 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: { paddingVertical: 10, gap: 6 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});
