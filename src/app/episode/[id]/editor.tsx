import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Marker } from '@/domain/editing/doc';
import { formatSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useServices } from '@/features/app/ServicesProvider';
import { playMonitor } from '@/features/editor/monitor';
import { useEditor } from '@/features/editor/useEditor';
import { Waveform } from '@/features/editor/Waveform';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { Button, Chip, Header, Loading, Row, Screen, Sheet, Toast, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type SheetKind = null | 'insert' | 'more' | 'overlay' | 'topics' | 'silence' | 'marker' | 'takes';

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useAppTheme();
  const services = useServices();
  const ed = useEditor(id);
  const { state } = ed;
  const { toast, show: showToast, act } = useToast();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [pps, setPps] = useState(24);
  const [silencePlan, setSilencePlan] = useState<{ ranges: Range[]; totalRemoved: Smp } | null>(
    null,
  );
  const [activeMarker, setActiveMarker] = useState<Marker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakerWarned, setSpeakerWarned] = useState(false);
  const [topicDraft, setTopicDraft] = useState('');

  const isRec = state.recording === 'recording' || state.recording === 'paused';
  const interrupted = state.recording === 'interrupted';

  useEffect(() => {
    const subs = [
      services.recording.on('error', (e) => setError(e.message)),
      services.recording.on('diskLow', () =>
        showToast({ text: '空き容量が少ないため録音を停止しました' }),
      ),
      services.recording.on('interruption', (e) => {
        if (e.type === 'began')
          showToast({ text: '割り込みで録音が止まりました。ここまでは保存済みです' });
      }),
      services.recording.on('routeChange', (e) => {
        if (e.reason === 'old_device_unavailable')
          showToast({ text: `入力が ${e.currentInput?.name ?? '内蔵マイク'} に切り替わりました` });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [services.recording, showToast]);

  const toggleRec = useCallback(async () => {
    try {
      if (isRec) {
        const r = await ed.stopRecording();
        if (r) showToast({ text: `録音を追加しました（${formatSmp(r.durationSmp)}）` });
        return;
      }
      if (interrupted) {
        await ed.resumeAfterInterruption();
        return;
      }
      await ed.startRecording();
      showToast({ text: '録音を開始しました（自動保存中）' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ed, interrupted, isRec, showToast]);

  const punchIn = useCallback(async () => {
    if (!state.selection) return;
    try {
      await ed.startRecording({ punchIn: state.selection });
      showToast({ text: '範囲を空けて録音しています' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ed, showToast, state.selection]);

  const doDelete = useCallback(async () => {
    const sel = state.selection;
    if (!sel) return;
    await ed.deleteSelection();
    showToast({
      text: `${formatSmp(smp(sel.end - sel.start), { tenths: true })} を削除しました`,
      action: '取り消す',
      onAction: () => void ed.undo(),
    });
  }, [ed, showToast, state.selection]);

  const doUndo = useCallback(async () => {
    const op = await ed.undo();
    if (op)
      showToast({
        text: `「${op.label}」を取り消しました`,
        action: 'やり直す',
        onAction: () => void ed.redo(),
      });
  }, [ed, showToast]);

  const doRedo = useCallback(async () => {
    const op = await ed.redo();
    if (op) showToast({ text: `「${op.label}」をやり直しました` });
  }, [ed, showToast]);

  const openSilence = useCallback(async () => {
    setSheet('silence');
    setSilencePlan(null);
    try {
      setSilencePlan(await ed.planSilence());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSheet(null);
    }
  }, [ed]);

  const insert = useCallback(
    async (a: AssetRow) => {
      setSheet(null);
      if (isRec) {
        await ed.insertAsset(a, 'recording');
        const mode = services.settings.monitor.jinglePlayback;
        const speaker = await services.recorder.isSpeakerOutput().catch(() => true);
        if (mode === 'always' || (mode === 'headphonesOnly' && !speaker)) {
          try {
            playMonitor(services.root, a.path);
          } catch {
            /* モニター再生の失敗は挿入結果に影響しない */
          }
          showToast({ text: `${a.name} を挿入しました` });
        } else {
          showToast({ text: `${a.name} を挿入しました（スピーカー出力中のためモニター再生なし）` });
          if (!speakerWarned) setSpeakerWarned(true);
        }
        return;
      }
      await ed.insertAsset(a, 'playhead');
      showToast({
        text: `${a.name} を ${formatSmp(state.playhead)} に挿入しました`,
        action: '取り消す',
        onAction: () => void ed.undo(),
      });
    },
    [
      ed,
      isRec,
      services.recorder,
      services.root,
      services.settings.monitor.jinglePlayback,
      showToast,
      speakerWarned,
      state.playhead,
    ],
  );

  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );
  const selectedOverlay = state.doc.overlays.find((o) => o.id === state.selectedOverlay) ?? null;
  const selectedAsset = selectedOverlay
    ? state.assets.find((a) => a.id === selectedOverlay.assetId)
    : null;
  const unresolved = ed.markersOnTimeline.filter(
    (m) => !m.marker.resolved && m.marker.kind !== 'topic',
  ).length;

  if (!state.ready) return <Loading label="読み込んでいます" />;

  const clock = isRec
    ? formatSmp(smp(state.total + state.recFrames), { tenths: true })
    : formatSmp(state.playhead, { tenths: true });
  const levelPct = state.level ? Math.max(0, Math.min(1, (state.level.rmsDb + 60) / 60)) : 0;

  return (
    <Screen scroll={false} padded={false} overlay={<Toast toast={toast} onAction={act} />}>
      <View style={{ paddingHorizontal: 16 }}>
        <Header
          title={
            state.episode ? `#${state.episode.episode_number} ${state.episode.title}` : 'Editor'
          }
          subtitle={
            isRec
              ? '録音中 — 自動保存しています'
              : interrupted
                ? '割り込みで停止中 — 録音ボタンで再開'
                : '自動保存済み'
          }
          onBack={() =>
            isRec ? showToast({ text: '録音中は戻れません。停止してください' }) : router.back()
          }
          right={
            <Pressable onPress={() => setSheet('more')} hitSlop={10} accessibilityLabel="メニュー">
              <Text style={{ color: c.ink2, fontSize: 22 }}>⋮</Text>
            </Pressable>
          }
        />
      </View>

      {/* 時計・レベル */}
      <View style={st.clockRow}>
        {isRec ? (
          <View style={[st.recPill, { borderColor: c.rec }]}>
            <View style={[st.recDot, { backgroundColor: c.rec }]} />
            <Text style={{ color: c.rec, fontSize: 11, fontWeight: '700' }}>
              REC {formatSmp(smp(state.recFrames))}
            </Text>
          </View>
        ) : null}
        <Text style={[st.clock, { color: c.ink }]}>{clock}</Text>
        <Text style={{ color: c.ink2, fontSize: 12 }}>/ {formatSmp(state.total)}</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setPps((p) => Math.max(4, p / 1.6))}
          hitSlop={8}
          accessibilityLabel="縮小"
        >
          <Text style={{ color: c.ink2, fontSize: 18 }}>－</Text>
        </Pressable>
        <Pressable
          onPress={() => setPps((p) => Math.min(200, p * 1.6))}
          hitSlop={8}
          accessibilityLabel="拡大"
          style={{ marginLeft: 12 }}
        >
          <Text style={{ color: c.ink2, fontSize: 18 }}>＋</Text>
        </Pressable>
      </View>
      {isRec ? (
        <View style={[st.meterTrack, { backgroundColor: c.panel }]}>
          <View
            style={[
              st.meterFill,
              {
                width: `${levelPct * 100}%`,
                backgroundColor: state.level?.clipped ? c.rec : c.voice,
              },
            ]}
          />
        </View>
      ) : null}

      {/* 波形 */}
      <Waveform
        voice={state.doc.voice}
        peaksByTake={state.peaksByTake}
        overlays={state.placedOverlays}
        markers={ed.markersOnTimeline}
        total={state.total}
        playhead={state.playhead}
        selection={state.selection}
        selectedOverlay={state.selectedOverlay}
        pps={pps}
        recording={isRec}
        recFrames={state.recFrames}
        onSeek={(t) => {
          if (!isRec) void ed.seek(t);
        }}
        onSelectOverlay={(oid) => {
          ed.selectOverlay(oid);
          if (oid) setSheet('overlay');
        }}
        onMarkerPress={(m) => {
          setActiveMarker(m);
          setSheet('marker');
        }}
      />

      {/* マーカーバナー */}
      {!isRec && unresolved > 0 ? (
        <Pressable
          onPress={() => void ed.nextMarker()}
          style={[st.banner, { backgroundColor: c.panel, borderColor: c.line }]}
        >
          <Text style={{ color: c.mistake }}>⚑</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 13, fontWeight: '600' }}>
              マーカー {unresolved} 件
            </Text>
            <Text style={{ color: c.ink2, fontSize: 11 }}>
              順番に確認して、その場で削除・取り消し
            </Text>
          </View>
          <Text style={{ color: c.accent, fontSize: 12 }}>次へ ›</Text>
        </Pressable>
      ) : null}

      {/* トークテーマ（録音中に見る） */}
      {state.topics.length > 0 ? (
        <View style={[st.topics, { backgroundColor: c.panel, borderColor: c.line }]}>
          {state.topics.slice(0, 6).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => void ed.toggleTopic(t.id)}
              style={st.topicRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!t.checkedAt }}
            >
              <Text style={{ color: t.checkedAt ? c.voice : c.ink3 }}>
                {t.checkedAt ? '☑' : '☐'}
              </Text>
              <Text
                style={{
                  color: t.checkedAt ? c.ink3 : c.ink,
                  textDecorationLine: t.checkedAt ? 'line-through' : 'none',
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {t.text}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setSheet('topics')}>
            <Text style={{ color: c.accent, fontSize: 12, marginTop: 4 }}>
              トークテーマを編集 ›
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setSheet('topics')}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: c.ink3, fontSize: 12 }}>
            ＋ トークテーマを追加（収録中に表示されます）
          </Text>
        </Pressable>
      )}

      <View style={{ flex: 1 }} />

      {/* ツールバー */}
      <View style={st.toolbar}>
        {isRec ? (
          <>
            <Chip label="● マーカー" onPress={() => void ed.addMarker('edit_point')} />
            <Chip
              label="噛んだ"
              color={c.mistake}
              active
              onPress={() => void ed.addMarker('mistake')}
            />
            {favorites.slice(0, 2).map((a) => (
              <Chip
                key={a.id}
                label={`♪ ${a.name}`}
                color={c.insert}
                onPress={() => void insert(a)}
              />
            ))}
            <Chip label="♪ 挿入" onPress={() => setSheet('insert')} />
            <Chip
              label={state.recording === 'paused' ? '▶ 再開' : '‖ 一時停止'}
              active
              onPress={() =>
                void (state.recording === 'paused' ? ed.resumeRecording() : ed.pauseRecording())
              }
            />
          </>
        ) : state.selection ? (
          <>
            <Chip label="削除" color={c.rec} active onPress={() => void doDelete()} />
            <Chip label="録り直す" onPress={() => void punchIn()} />
            <Chip label="始点=ここ" onPress={ed.setSelectionStart} />
            <Chip label="終点=ここ" onPress={ed.setSelectionEnd} />
            <Chip label="解除" onPress={ed.clearSelection} />
          </>
        ) : (
          <>
            <Chip label="＋ 挿入" onPress={() => setSheet('insert')} />
            <Chip label="● マーカー" onPress={() => void ed.addMarker('edit_point')} />
            <Chip label="範囲を選ぶ" onPress={ed.setSelectionStart} />
            <Chip label="無音を削除" onPress={() => void openSilence()} />
            <Chip label="テイク" onPress={() => setSheet('takes')} />
          </>
        )}
      </View>
      <Text style={[st.hint, { color: c.ink3 }]}>
        {isRec
          ? '録音中は編集操作を止めています。マーカーは後でジャンプできます'
          : state.selection
            ? `${formatSmp(state.selection.start)} 〜 ${formatSmp(state.selection.end)} を選択中。再生位置を動かして始点/終点を打ち直せます`
            : 'タイムラインをタップで再生位置。素材をタップで音量・位置'}
      </Text>

      {/* トランスポート */}
      <View style={[st.transport, { borderTopColor: c.line }]}>
        <Pressable
          onPress={() => void doUndo()}
          disabled={!state.canUndo || isRec}
          style={[st.side, { opacity: state.canUndo && !isRec ? 1 : 0.35 }]}
          accessibilityLabel="取り消す"
        >
          <Text style={{ color: c.ink, fontSize: 20 }}>↶</Text>
          <Text style={{ color: c.ink2, fontSize: 10 }}>取り消す</Text>
        </Pressable>
        <Pressable
          onPress={() => void toggleRec()}
          accessibilityLabel={isRec ? '録音を停止' : '録音を開始'}
          style={[st.recBtn, { backgroundColor: isRec ? c.panel : c.rec, borderColor: c.rec }]}
        >
          <View style={isRec ? [st.recStop, { backgroundColor: c.rec }] : st.recDotBig} />
        </Pressable>
        <Pressable
          onPress={() => void ed.togglePlay()}
          disabled={isRec || state.total === 0}
          style={[
            st.playBtn,
            { borderColor: c.line, opacity: isRec || state.total === 0 ? 0.35 : 1 },
          ]}
          accessibilityLabel={state.playing ? '一時停止' : '再生'}
        >
          <Text style={{ color: c.ink, fontSize: 18 }}>{state.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable
          onPress={() => void doRedo()}
          disabled={!state.canRedo || isRec}
          style={[st.side, { opacity: state.canRedo && !isRec ? 1 : 0.35 }]}
          accessibilityLabel="やり直す"
        >
          <Text style={{ color: c.ink, fontSize: 20 }}>↷</Text>
          <Text style={{ color: c.ink2, fontSize: 10 }}>やり直す</Text>
        </Pressable>
      </View>

      {/* ---- シート ---- */}
      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title="挿入"
        subtitle={
          isRec ? '今の発言位置に挿入します' : `再生位置 ${formatSmp(state.playhead)} に追加します`
        }
      >
        {state.assets.length === 0 ? (
          <Text style={{ color: c.ink2 }}>
            Show Assets に素材がありません。Home →「Show Assets」から追加してください。
          </Text>
        ) : null}
        {state.assets.map((a) => (
          <Row
            key={a.id}
            label={`${a.is_favorite ? '★ ' : ''}${a.name}`}
            sub={`${a.kind} · ${formatSmp(smp(a.duration_smp))}`}
            onPress={() => void insert(a)}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'overlay' && !!selectedOverlay}
        onClose={() => {
          setSheet(null);
          ed.selectOverlay(null);
        }}
        title={selectedAsset?.name ?? '素材'}
        subtitle={
          selectedOverlay ? `${selectedOverlay.kind} · ${selectedOverlay.gainDb.toFixed(1)} dB` : ''
        }
      >
        {selectedOverlay ? (
          <>
            <View style={st.gainRow}>
              <Text style={{ color: c.ink }}>音量</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() =>
                  void ed.updateOverlay(
                    selectedOverlay.id,
                    '音量を変更',
                    (o) => ({ ...o, gainDb: Math.max(-40, o.gainDb - 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={8}
                style={st.pm}
              >
                <Text style={{ color: c.ink, fontSize: 18 }}>－</Text>
              </Pressable>
              <Text style={{ color: c.ink, width: 72, textAlign: 'center' }}>
                {selectedOverlay.gainDb.toFixed(1)} dB
              </Text>
              <Pressable
                onPress={() =>
                  void ed.updateOverlay(
                    selectedOverlay.id,
                    '音量を変更',
                    (o) => ({ ...o, gainDb: Math.min(12, o.gainDb + 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={8}
                style={st.pm}
              >
                <Text style={{ color: c.ink, fontSize: 18 }}>＋</Text>
              </Pressable>
            </View>
            {selectedOverlay.kind === 'bgm' ? (
              <Row
                label="しゃべり中は音量を下げる"
                sub="Ducking"
                right={
                  <Toggle
                    value={selectedOverlay.duck}
                    onChange={(v) =>
                      void ed.updateOverlay(selectedOverlay.id, 'ダッキングを変更', (o) => ({
                        ...o,
                        duck: v,
                      }))
                    }
                  />
                }
              />
            ) : null}
            <Row
              label="フェードイン 2 秒"
              right={
                <Toggle
                  value={selectedOverlay.fadeIn > 0}
                  onChange={(v) =>
                    void ed.updateOverlay(selectedOverlay.id, 'フェードを変更', (o) => ({
                      ...o,
                      fadeIn: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            <Row
              label="フェードアウト 2 秒"
              right={
                <Toggle
                  value={selectedOverlay.fadeOut > 0}
                  onChange={(v) =>
                    void ed.updateOverlay(selectedOverlay.id, 'フェードを変更', (o) => ({
                      ...o,
                      fadeOut: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            {selectedOverlay.kind !== 'opening' && selectedOverlay.kind !== 'ending' ? (
              <Row
                label="再生位置へ移動"
                sub={`${formatSmp(state.playhead)} に置き直す（発言に追従）`}
                onPress={() => {
                  void ed.moveOverlayTo(selectedOverlay.id, state.playhead);
                  setSheet(null);
                }}
              />
            ) : null}
            <Row
              label="タイムラインから削除"
              danger
              onPress={() => {
                void ed.removeOverlay(selectedOverlay.id);
                setSheet(null);
                showToast({
                  text: '素材を削除しました',
                  action: '取り消す',
                  onAction: () => void ed.undo(),
                });
              }}
            />
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'more'}
        onClose={() => setSheet(null)}
        title={state.episode?.title ?? ''}
        subtitle="工程"
      >
        <Row
          label="エピソードのトップ"
          sub="制作状況・テイク一覧"
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}`);
          }}
        />
        <Row
          label="エピソードの詳細"
          sub="タイトル・概要"
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/details`);
          }}
        />
        <Row
          label="音の仕上げ"
          sub="ラウドネス・ダッキング"
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/sound`);
          }}
        />
        <Row
          label="書き出し"
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/export`);
          }}
        />
        <Row
          label="Show Assets"
          onPress={() => {
            setSheet(null);
            router.push('/show/assets');
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet === 'silence'}
        onClose={() => setSheet(null)}
        title="無音を削除"
        subtitle={`${services.settings.silence.minDurationMs / 1000} 秒以上・${services.settings.silence.thresholdDb} dB 未満の区間を詰めます`}
      >
        {!silencePlan ? (
          <Text style={{ color: c.ink2 }}>解析しています…</Text>
        ) : silencePlan.ranges.length === 0 ? (
          <Text style={{ color: c.ink2 }}>該当する無音はありませんでした</Text>
        ) : (
          <>
            <Text style={{ color: c.ink, marginBottom: 12 }}>
              {silencePlan.ranges.length} 箇所、合計{' '}
              {formatSmp(silencePlan.totalRemoved, { tenths: true })} を削除します。
            </Text>
            <Button
              label="適用する"
              onPress={async () => {
                setSheet(null);
                await ed.applySilencePlan(silencePlan.ranges);
                showToast({
                  text: `${silencePlan.ranges.length} 箇所の無音を詰めました`,
                  action: '取り消す',
                  onAction: () => void ed.undo(),
                });
              }}
            />
          </>
        )}
      </Sheet>

      <Sheet
        visible={sheet === 'marker' && !!activeMarker}
        onClose={() => setSheet(null)}
        title={
          activeMarker?.kind === 'mistake'
            ? '言い間違い'
            : activeMarker?.kind === 'interruption'
              ? '割り込み'
              : 'マーカー'
        }
        subtitle={activeMarker?.label || ''}
      >
        {activeMarker ? (
          <>
            <Row
              label="ここへ移動"
              onPress={() => {
                const at = ed.markersOnTimeline.find((m) => m.marker.id === activeMarker.id)?.at;
                if (at !== undefined) void ed.seek(at);
                setSheet(null);
              }}
            />
            <Row
              label="ここから範囲を選ぶ"
              sub="始点をマーカーに置く"
              onPress={() => {
                const at = ed.markersOnTimeline.find((m) => m.marker.id === activeMarker.id)?.at;
                if (at !== undefined) void ed.seek(at).then(() => ed.setSelectionStart());
                setSheet(null);
              }}
            />
            <Row
              label="対応済みにする"
              onPress={() => {
                void ed.resolveMarker(activeMarker.id);
                setSheet(null);
              }}
            />
            <Row
              label="マーカーを削除"
              danger
              onPress={() => {
                void ed.removeMarker(activeMarker.id);
                setSheet(null);
              }}
            />
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'takes'}
        onClose={() => setSheet(null)}
        title="テイク"
        subtitle="声トラックの並び"
      >
        {state.doc.voice.map((v, i) => {
          const take = state.takes.find((t) => t.id === v.takeId);
          return (
            <Row
              key={v.id}
              label={`${i + 1}. ${take?.name ?? v.takeId.slice(0, 6)}`}
              sub={`${formatSmp(smp(v.srcEnd - v.srcStart))} · ${v.gainDb.toFixed(1)} dB`}
              right={
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  <Pressable
                    onPress={() => void ed.moveTake(i, i - 1)}
                    disabled={i === 0}
                    hitSlop={6}
                  >
                    <Text style={{ color: i === 0 ? c.ink3 : c.ink }}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.moveTake(i, i + 1)}
                    disabled={i === state.doc.voice.length - 1}
                    hitSlop={6}
                  >
                    <Text style={{ color: i === state.doc.voice.length - 1 ? c.ink3 : c.ink }}>
                      ↓
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.setVoiceGain(i, Math.max(-20, v.gainDb - 1))}
                    hitSlop={6}
                  >
                    <Text style={{ color: c.ink }}>－</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.setVoiceGain(i, Math.min(12, v.gainDb + 1))}
                    hitSlop={6}
                  >
                    <Text style={{ color: c.ink }}>＋</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void ed.removeVoiceSegment(i);
                      showToast({
                        text: 'タイムラインから削除しました（元データは残ります）',
                        action: '取り消す',
                        onAction: () => void ed.undo(),
                      });
                    }}
                    hitSlop={6}
                  >
                    <Text style={{ color: c.rec }}>✕</Text>
                  </Pressable>
                </View>
              }
            />
          );
        })}
        {state.doc.voice.length === 0 ? (
          <Text style={{ color: c.ink2 }}>まだ録音がありません</Text>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'topics'}
        onClose={() => setSheet(null)}
        title="トークテーマ"
        subtitle="収録中に画面で見ながらチェックできます。音声入力はキーボードのマイクから"
      >
        {state.topics.map((t, i) => (
          <Row
            key={t.id}
            label={t.text}
            right={
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Pressable
                  onPress={() => {
                    const a = [...state.topics];
                    if (i > 0) {
                      [a[i - 1], a[i]] = [a[i]!, a[i - 1]!];
                      void ed.saveTopics(a);
                    }
                  }}
                  hitSlop={6}
                >
                  <Text style={{ color: c.ink }}>↑</Text>
                </Pressable>
                <Pressable
                  onPress={() => void ed.saveTopics(state.topics.filter((x) => x.id !== t.id))}
                  hitSlop={6}
                >
                  <Text style={{ color: c.rec }}>✕</Text>
                </Pressable>
              </View>
            }
          />
        ))}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TextInput
            value={topicDraft}
            onChangeText={setTopicDraft}
            placeholder="話すテーマを追加"
            placeholderTextColor={c.ink3}
            style={[st.input, { color: c.ink, borderColor: c.line, backgroundColor: c.panel2 }]}
            accessibilityLabel="トークテーマ"
            onSubmitEditing={() => {
              if (topicDraft.trim()) {
                void ed.saveTopics([
                  ...state.topics,
                  {
                    id: services.newId(),
                    position: state.topics.length,
                    text: topicDraft.trim(),
                    checkedAt: null,
                  },
                ]);
                setTopicDraft('');
              }
            }}
          />
          <Button
            label="追加"
            kind="secondary"
            onPress={() => {
              if (topicDraft.trim()) {
                void ed.saveTopics([
                  ...state.topics,
                  {
                    id: services.newId(),
                    position: state.topics.length,
                    text: topicDraft.trim(),
                    checkedAt: null,
                  },
                ]);
                setTopicDraft('');
              }
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={!!error} onClose={() => setError(null)} title="エラー">
        <Text style={{ color: c.ink, lineHeight: 20 }}>{error}</Text>
        <Button
          label="閉じる"
          kind="secondary"
          onPress={() => setError(null)}
          style={{ marginTop: 12 }}
        />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  clock: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  meterTrack: {
    height: 4,
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  meterFill: { height: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  topics: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  hint: { fontSize: 11, paddingHorizontal: 16, paddingBottom: 6 },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  side: { alignItems: 'center', width: 64 },
  recBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recDotBig: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' },
  recStop: { width: 24, height: 24, borderRadius: 5 },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gainRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  pm: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});
