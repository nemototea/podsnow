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
import { kindLabel } from '@/features/show/assetKinds';
import { errorCodeText, errorText, useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import {
  glyphSlop,
  gutter,
  hit,
  icon,
  radius,
  space,
  tabularNums,
  tone,
  typography,
} from '@/ui/tokens';
import { Button, Chip, Header, Loading, Row, Screen, Sheet, Toast, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

type SheetKind = null | 'insert' | 'more' | 'overlay' | 'topics' | 'silence' | 'marker' | 'takes';

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useAppTheme();
  const t = useT();
  const services = useServices();
  const ed = useEditor(id);
  const { state } = ed;
  const { toast, show: showToast, act, dismiss } = useToast();
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
      services.recording.on('error', (e) =>
        setError(e.code ? errorCodeText(t, e.code) : e.message),
      ),
      services.recording.on('diskLow', () => showToast({ text: t.editor.diskLow })),
      services.recording.on('interruption', (e) => {
        if (e.type === 'began') showToast({ text: t.editor.interrupted });
      }),
      services.recording.on('routeChange', (e) => {
        if (e.reason === 'old_device_unavailable')
          showToast({
            text: t.editor.routeChanged(e.currentInput?.name ?? t.editor.builtInMic),
          });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [services.recording, showToast, t]);

  const toggleRec = useCallback(async () => {
    try {
      if (isRec) {
        const r = await ed.stopRecording();
        if (r) showToast({ text: t.editor.takeAdded(formatSmp(r.durationSmp)) });
        return;
      }
      if (interrupted) {
        await ed.resumeAfterInterruption();
        return;
      }
      await ed.startRecording();
      showToast({ text: t.editor.recordingStarted });
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [ed, interrupted, isRec, showToast, t]);

  const punchIn = useCallback(async () => {
    if (!state.selection) return;
    try {
      await ed.startRecording({ punchIn: state.selection });
      showToast({ text: t.editor.punchInStarted });
    } catch (e) {
      setError(errorText(t, e));
    }
  }, [ed, showToast, state.selection, t]);

  const doDelete = useCallback(async () => {
    const sel = state.selection;
    if (!sel) return;
    await ed.deleteSelection();
    showToast({
      text: t.editor.rangeDeleted(formatSmp(smp(sel.end - sel.start), { tenths: true })),
      action: t.common.undo,
      onAction: () => void ed.undo(),
    });
  }, [ed, showToast, state.selection, t]);

  const doUndo = useCallback(async () => {
    const op = await ed.undo();
    if (op)
      showToast({
        text: t.undo.undid(op.label),
        action: t.common.redo,
        onAction: () => void ed.redo(),
      });
  }, [ed, showToast, t]);

  const doRedo = useCallback(async () => {
    const op = await ed.redo();
    if (op) showToast({ text: t.undo.redid(op.label) });
  }, [ed, showToast, t]);

  const openSilence = useCallback(async () => {
    setSheet('silence');
    setSilencePlan(null);
    try {
      setSilencePlan(await ed.planSilence());
    } catch (e) {
      setError(errorText(t, e));
      setSheet(null);
    }
  }, [ed, t]);

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
          showToast({ text: t.editor.inserted(a.name) });
        } else {
          showToast({ text: t.editor.insertedNoMonitor(a.name) });
          if (!speakerWarned) setSpeakerWarned(true);
        }
        return;
      }
      await ed.insertAsset(a, 'playhead');
      showToast({
        text: t.editor.insertedAt(a.name, formatSmp(state.playhead)),
        action: t.common.undo,
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
      t,
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

  if (!state.ready) return <Loading label={t.common.loading} />;

  const clock = isRec
    ? formatSmp(smp(state.total + state.recFrames), { tenths: true })
    : formatSmp(state.playhead, { tenths: true });
  const levelPct = state.level ? Math.max(0, Math.min(1, (state.level.rmsDb + 60) / 60)) : 0;

  return (
    <Screen
      scroll={false}
      padded={false}
      overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}
      bottomBar={
        <View style={[st.transport, { borderTopColor: c.border }]}>
          <Pressable
            onPress={() => void doUndo()}
            disabled={!state.canUndo || isRec}
            style={[st.side, { opacity: state.canUndo && !isRec ? 1 : 0.35 }]}
            accessibilityLabel={t.common.undo}
          >
            <Text style={{ color: c.textPrimary, fontSize: icon.md }}>↶</Text>
            <Text style={[typography.overline, { color: c.textSecondary }]}>{t.common.undo}</Text>
          </Pressable>
          <Pressable
            onPress={() => void toggleRec()}
            accessibilityLabel={isRec ? t.a11y.stopRecording : t.a11y.startRecording}
            style={[
              st.recBtn,
              { backgroundColor: isRec ? c.surface : c.recSolid, borderColor: c.recSolid },
            ]}
          >
            <View
              style={
                isRec
                  ? [st.recStop, { backgroundColor: c.recSolid }]
                  : [st.recDotBig, { backgroundColor: c.dangerOnSolid }]
              }
            />
          </Pressable>
          <Pressable
            onPress={() => void ed.togglePlay()}
            disabled={isRec || state.total === 0}
            style={[
              st.playBtn,
              { borderColor: c.border, opacity: isRec || state.total === 0 ? 0.35 : 1 },
            ]}
            accessibilityLabel={state.playing ? t.a11y.pause : t.a11y.play}
          >
            <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>
              {state.playing ? '❚❚' : '▶'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void doRedo()}
            disabled={!state.canRedo || isRec}
            style={[st.side, { opacity: state.canRedo && !isRec ? 1 : 0.35 }]}
            accessibilityLabel={t.common.redo}
          >
            <Text style={{ color: c.textPrimary, fontSize: icon.md }}>↷</Text>
            <Text style={[typography.overline, { color: c.textSecondary }]}>{t.common.redo}</Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ paddingHorizontal: gutter }}>
        <Header
          title={
            state.episode
              ? `#${state.episode.episode_number} ${state.episode.title || t.episode.untitled}`
              : t.editor.fallbackTitle
          }
          subtitle={
            isRec
              ? t.editor.subtitleRecording
              : interrupted
                ? t.editor.subtitleInterrupted
                : t.editor.subtitleSaved
          }
          onBack={() =>
            isRec ? showToast({ text: t.editor.cannotLeaveWhileRecording }) : router.back()
          }
          right={
            <Pressable
              onPress={() => setSheet('more')}
              hitSlop={glyphSlop}
              accessibilityLabel={t.a11y.menu}
            >
              <Text style={{ color: c.textSecondary, fontSize: icon.md }}>⋮</Text>
            </Pressable>
          }
        />
      </View>

      {/* 時計・レベル */}
      <View style={st.clockRow}>
        {isRec ? (
          <View style={[st.recPill, { borderColor: c.recSolid }]}>
            <View style={[st.recDot, { backgroundColor: c.recSolid }]} />
            <Text style={[typography.overline, { color: c.dangerText }]}>
              REC {formatSmp(smp(state.recFrames))}
            </Text>
          </View>
        ) : null}
        <Text style={[st.clock, { color: c.textPrimary }]}>{clock}</Text>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          / {formatSmp(state.total)}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setPps((p) => Math.max(4, p / 1.6))}
          hitSlop={glyphSlop}
          accessibilityLabel={t.a11y.zoomOut}
        >
          <Text style={{ color: c.textSecondary, fontSize: icon.sm }}>－</Text>
        </Pressable>
        <Pressable
          onPress={() => setPps((p) => Math.min(200, p * 1.6))}
          hitSlop={glyphSlop}
          accessibilityLabel={t.a11y.zoomIn}
          style={{ marginLeft: space.md }}
        >
          <Text style={{ color: c.textSecondary, fontSize: icon.sm }}>＋</Text>
        </Pressable>
      </View>
      {isRec ? (
        <View style={[st.meterTrack, { backgroundColor: c.surface }]}>
          <View
            style={[
              st.meterFill,
              {
                width: `${levelPct * 100}%`,
                backgroundColor: state.level?.clipped ? c.recSolid : c.voiceSolid,
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
          style={[st.banner, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Text style={{ color: c.mistakeText }}>⚑</Text>
          <View style={{ flex: 1 }}>
            <Text style={[typography.label, { color: c.textPrimary }]}>
              {t.editor.markerBannerTitle(unresolved)}
            </Text>
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {t.editor.markerBannerSub}
            </Text>
          </View>
          <Text style={[typography.caption, { color: c.accentText }]}>{t.common.next}</Text>
        </Pressable>
      ) : null}

      {/* トークテーマ（録音中に見る） */}
      {state.topics.length > 0 ? (
        <View style={[st.topics, { backgroundColor: c.surface, borderColor: c.border }]}>
          {state.topics.slice(0, 6).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => void ed.toggleTopic(t.id)}
              style={st.topicRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!t.checkedAt }}
            >
              <Text style={{ color: t.checkedAt ? c.successText : c.textTertiary }}>
                {t.checkedAt ? '☑' : '☐'}
              </Text>
              <Text
                style={{
                  color: t.checkedAt ? c.textTertiary : c.textPrimary,
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
            <Text style={[typography.caption, { color: c.accentText, marginTop: space.xs }]}>
              {t.editor.editTopics}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setSheet('topics')}
          style={{ paddingHorizontal: gutter, paddingVertical: space.sm }}
        >
          <Text style={[typography.caption, { color: c.textTertiary }]}>{t.editor.addTopics}</Text>
        </Pressable>
      )}

      <View style={{ flex: 1 }} />

      {/* ツールバー */}
      <View style={st.toolbar}>
        {isRec ? (
          <>
            <Chip label={t.editor.toolbar.marker} onPress={() => void ed.addMarker('edit_point')} />
            <Chip
              label={t.editor.toolbar.mistake}
              tone={tone(c, 'mistake')}
              active
              onPress={() => void ed.addMarker('mistake')}
            />
            {favorites.slice(0, 2).map((a) => (
              <Chip
                key={a.id}
                label={t.editor.toolbar.quickInsert(a.name)}
                tone={tone(c, 'insert')}
                onPress={() => void insert(a)}
              />
            ))}
            <Chip label={t.editor.toolbar.insert} onPress={() => setSheet('insert')} />
            <Chip
              label={
                state.recording === 'paused' ? t.editor.toolbar.resume : t.editor.toolbar.pause
              }
              active
              onPress={() =>
                void (state.recording === 'paused' ? ed.resumeRecording() : ed.pauseRecording())
              }
            />
          </>
        ) : state.selection ? (
          <>
            <Chip
              label={t.editor.toolbar.delete}
              tone={tone(c, 'danger')}
              active
              onPress={() => void doDelete()}
            />
            <Chip label={t.editor.toolbar.punchIn} onPress={() => void punchIn()} />
            <Chip label={t.editor.toolbar.selectionStart} onPress={ed.setSelectionStart} />
            <Chip label={t.editor.toolbar.selectionEnd} onPress={ed.setSelectionEnd} />
            <Chip label={t.editor.toolbar.clearSelection} onPress={ed.clearSelection} />
          </>
        ) : (
          <>
            <Chip label={t.editor.toolbar.insertPlus} onPress={() => setSheet('insert')} />
            <Chip label={t.editor.toolbar.marker} onPress={() => void ed.addMarker('edit_point')} />
            <Chip label={t.editor.toolbar.selectRange} onPress={ed.setSelectionStart} />
            <Chip label={t.editor.toolbar.removeSilence} onPress={() => void openSilence()} />
            <Chip label={t.editor.toolbar.takes} onPress={() => setSheet('takes')} />
          </>
        )}
      </View>
      <Text style={[st.hint, { color: c.textTertiary }]}>
        {isRec
          ? t.editor.hintRecording
          : state.selection
            ? t.editor.hintSelection(
                formatSmp(state.selection.start),
                formatSmp(state.selection.end),
              )
            : t.editor.hintIdle}
      </Text>

      {/* ---- シート ---- */}
      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.editor.insertSheet.title}
        subtitle={
          isRec
            ? t.editor.insertSheet.subtitleRecording
            : t.editor.insertSheet.subtitlePlayhead(formatSmp(state.playhead))
        }
      >
        {state.assets.length === 0 ? (
          <Text style={{ color: c.textSecondary }}>{t.editor.insertSheet.empty}</Text>
        ) : null}
        {state.assets.map((a) => (
          <Row
            key={a.id}
            label={`${a.is_favorite ? '★ ' : ''}${a.name}`}
            sub={`${kindLabel(t, a.kind)} · ${formatSmp(smp(a.duration_smp))}`}
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
        title={selectedAsset?.name ?? t.editor.overlay.fallbackTitle}
        subtitle={
          selectedOverlay
            ? `${kindLabel(t, selectedOverlay.kind)} · ${selectedOverlay.gainDb.toFixed(1)} dB`
            : ''
        }
      >
        {selectedOverlay ? (
          <>
            <View style={st.gainRow}>
              <Text style={{ color: c.textPrimary }}>{t.editor.overlay.gain}</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() =>
                  void ed.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.max(-40, o.gainDb - 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={glyphSlop}
                style={st.pm}
              >
                <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>－</Text>
              </Pressable>
              <Text style={{ color: c.textPrimary, width: 72, textAlign: 'center' }}>
                {selectedOverlay.gainDb.toFixed(1)} dB
              </Text>
              <Pressable
                onPress={() =>
                  void ed.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.min(12, o.gainDb + 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={glyphSlop}
                style={st.pm}
              >
                <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>＋</Text>
              </Pressable>
            </View>
            {selectedOverlay.kind === 'bgm' ? (
              <Row
                label={t.editor.overlay.duck}
                sub={t.editor.overlay.duckSub}
                right={
                  <Toggle
                    value={selectedOverlay.duck}
                    onChange={(v) =>
                      void ed.updateOverlay(selectedOverlay.id, t.undo.changeDucking, (o) => ({
                        ...o,
                        duck: v,
                      }))
                    }
                  />
                }
              />
            ) : null}
            <Row
              label={t.editor.overlay.fadeIn}
              right={
                <Toggle
                  value={selectedOverlay.fadeIn > 0}
                  onChange={(v) =>
                    void ed.updateOverlay(selectedOverlay.id, t.undo.changeFade, (o) => ({
                      ...o,
                      fadeIn: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            <Row
              label={t.editor.overlay.fadeOut}
              right={
                <Toggle
                  value={selectedOverlay.fadeOut > 0}
                  onChange={(v) =>
                    void ed.updateOverlay(selectedOverlay.id, t.undo.changeFade, (o) => ({
                      ...o,
                      fadeOut: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            {selectedOverlay.kind !== 'opening' && selectedOverlay.kind !== 'ending' ? (
              <Row
                label={t.editor.overlay.moveToPlayhead}
                sub={t.editor.overlay.moveToPlayheadSub(formatSmp(state.playhead))}
                onPress={() => {
                  void ed.moveOverlayTo(selectedOverlay.id, state.playhead);
                  setSheet(null);
                }}
              />
            ) : null}
            <Row
              label={t.editor.overlay.remove}
              danger
              onPress={() => {
                void ed.removeOverlay(selectedOverlay.id);
                setSheet(null);
                showToast({
                  text: t.editor.overlay.removed,
                  action: t.common.undo,
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
        subtitle={t.editor.more.subtitle}
      >
        <Row
          label={t.editor.more.episodeTop}
          sub={t.editor.more.episodeTopSub}
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}`);
          }}
        />
        <Row
          label={t.editor.more.details}
          sub={t.editor.more.detailsSub}
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/details`);
          }}
        />
        <Row
          label={t.editor.more.sound}
          sub={t.editor.more.soundSub}
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/sound`);
          }}
        />
        <Row
          label={t.editor.more.export}
          onPress={() => {
            setSheet(null);
            router.push(`/episode/${id}/export`);
          }}
        />
        <Row
          label={t.editor.more.showAssets}
          onPress={() => {
            setSheet(null);
            router.push('/show/assets');
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet === 'silence'}
        onClose={() => setSheet(null)}
        title={t.editor.silence.title}
        subtitle={t.editor.silence.subtitle(
          String(services.settings.silence.minDurationMs / 1000),
          services.settings.silence.thresholdDb,
        )}
      >
        {!silencePlan ? (
          <Text style={{ color: c.textSecondary }}>{t.editor.silence.analyzing}</Text>
        ) : silencePlan.ranges.length === 0 ? (
          <Text style={{ color: c.textSecondary }}>{t.editor.silence.none}</Text>
        ) : (
          <>
            <Text style={{ color: c.textPrimary, marginBottom: space.md }}>
              {t.editor.silence.plan(
                silencePlan.ranges.length,
                formatSmp(silencePlan.totalRemoved, { tenths: true }),
              )}
            </Text>
            <Button
              label={t.editor.silence.apply}
              onPress={async () => {
                setSheet(null);
                await ed.applySilencePlan(silencePlan.ranges);
                showToast({
                  text: t.editor.silence.applied(silencePlan.ranges.length),
                  action: t.common.undo,
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
            ? t.editor.marker.mistake
            : activeMarker?.kind === 'interruption'
              ? t.editor.marker.interruption
              : t.editor.marker.generic
        }
        subtitle={activeMarker?.label || ''}
      >
        {activeMarker ? (
          <>
            <Row
              label={t.editor.marker.seek}
              onPress={() => {
                const at = ed.markersOnTimeline.find((m) => m.marker.id === activeMarker.id)?.at;
                if (at !== undefined) void ed.seek(at);
                setSheet(null);
              }}
            />
            <Row
              label={t.editor.marker.selectFromHere}
              sub={t.editor.marker.selectFromHereSub}
              onPress={() => {
                const at = ed.markersOnTimeline.find((m) => m.marker.id === activeMarker.id)?.at;
                if (at !== undefined) void ed.seek(at).then(() => ed.setSelectionStart());
                setSheet(null);
              }}
            />
            <Row
              label={t.editor.marker.resolve}
              onPress={() => {
                void ed.resolveMarker(activeMarker.id);
                setSheet(null);
              }}
            />
            <Row
              label={t.editor.marker.remove}
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
        title={t.editor.takes.title}
        subtitle={t.editor.takes.subtitle}
      >
        {state.doc.voice.map((v, i) => {
          const take = state.takes.find((t) => t.id === v.takeId);
          return (
            <Row
              key={v.id}
              label={`${i + 1}. ${take?.name ?? v.takeId.slice(0, 6)}`}
              sub={`${formatSmp(smp(v.srcEnd - v.srcStart))} · ${v.gainDb.toFixed(1)} dB`}
              right={
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <Pressable
                    onPress={() => void ed.moveTake(i, i - 1)}
                    disabled={i === 0}
                    hitSlop={glyphSlop}
                  >
                    <Text style={{ color: i === 0 ? c.textTertiary : c.textPrimary }}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.moveTake(i, i + 1)}
                    disabled={i === state.doc.voice.length - 1}
                    hitSlop={glyphSlop}
                  >
                    <Text
                      style={{
                        color: i === state.doc.voice.length - 1 ? c.textTertiary : c.textPrimary,
                      }}
                    >
                      ↓
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.setVoiceGain(i, Math.max(-20, v.gainDb - 1))}
                    hitSlop={glyphSlop}
                  >
                    <Text style={{ color: c.textPrimary }}>－</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ed.setVoiceGain(i, Math.min(12, v.gainDb + 1))}
                    hitSlop={glyphSlop}
                  >
                    <Text style={{ color: c.textPrimary }}>＋</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void ed.removeVoiceSegment(i);
                      showToast({
                        text: t.editor.takes.removed,
                        action: t.common.undo,
                        onAction: () => void ed.undo(),
                      });
                    }}
                    hitSlop={glyphSlop}
                  >
                    <Text style={{ color: c.dangerText }}>✕</Text>
                  </Pressable>
                </View>
              }
            />
          );
        })}
        {state.doc.voice.length === 0 ? (
          <Text style={{ color: c.textSecondary }}>{t.editor.takes.empty}</Text>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === 'topics'}
        onClose={() => setSheet(null)}
        title={t.editor.topics.title}
        subtitle={t.editor.topics.subtitle}
      >
        {state.topics.map((t, i) => (
          <Row
            key={t.id}
            label={t.text}
            right={
              <View style={{ flexDirection: 'row', gap: space.lg }}>
                <Pressable
                  onPress={() => {
                    const a = [...state.topics];
                    if (i > 0) {
                      [a[i - 1], a[i]] = [a[i]!, a[i - 1]!];
                      void ed.saveTopics(a);
                    }
                  }}
                  hitSlop={glyphSlop}
                >
                  <Text style={{ color: c.textPrimary }}>↑</Text>
                </Pressable>
                <Pressable
                  onPress={() => void ed.saveTopics(state.topics.filter((x) => x.id !== t.id))}
                  hitSlop={glyphSlop}
                >
                  <Text style={{ color: c.dangerText }}>✕</Text>
                </Pressable>
              </View>
            }
          />
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <TextInput
            value={topicDraft}
            onChangeText={setTopicDraft}
            placeholder={t.editor.topics.placeholder}
            placeholderTextColor={c.textTertiary}
            style={[
              st.input,
              { color: c.textPrimary, borderColor: c.border, backgroundColor: c.surfaceRaised },
            ]}
            accessibilityLabel={t.editor.topics.title}
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
            label={t.common.add}
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

      <Sheet visible={!!error} onClose={() => setError(null)} title={t.common.error}>
        <Text style={{ color: c.textPrimary, lineHeight: 20 }}>{error}</Text>
        <Button
          label={t.common.close}
          kind="secondary"
          onPress={() => setError(null)}
          style={{ marginTop: space.md }}
        />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingHorizontal: gutter,
    paddingVertical: space.xs,
  },
  clock: { ...typography.display, ...tabularNums },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.hair,
  },
  recDot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  meterTrack: {
    height: space.xs,
    marginHorizontal: gutter,
    borderRadius: radius.xs,
    overflow: 'hidden',
    marginBottom: space.sm,
  },
  meterFill: { height: space.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: gutter,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  topics: {
    marginHorizontal: gutter,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.xs,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: hit.compact,
    paddingVertical: space.xs,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: gutter,
    paddingVertical: space.sm,
  },
  hint: { ...typography.caption, paddingHorizontal: gutter, paddingBottom: space.sm },
  // 下端の safe area は Screen の bottomBar が足すので、ここでは持たない（Issue #89）。
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  side: { alignItems: 'center', width: 64, minHeight: hit.min, justifyContent: 'center' },
  recBtn: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recDotBig: { width: 26, height: 26, borderRadius: radius.pill },
  recStop: { width: 24, height: 24, borderRadius: radius.xs },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  pm: {
    width: hit.compact,
    height: hit.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    ...typography.body,
    flex: 1,
    minHeight: hit.min,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
});
