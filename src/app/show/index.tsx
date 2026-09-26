import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { splitIntoHeadings } from '@/domain/outline';
import { useServices } from '@/features/app/ServicesProvider';
import { kindLabel } from '@/features/show/assetKinds';
import { useAsyncData } from '@/features/show/useAsyncData';
import { errorText, useT, type Messages } from '@/i18n';
import type { AssetKind, AssetRow } from '@/infra/db/repositories/assetsRepo';
import {
  getDefaultTemplate,
  getLayout,
  getShow,
  updateLayout,
  updateShow,
  updateTemplate,
  type ShowLayoutRow,
  type ShowRow,
  type TemplateRow,
} from '@/infra/db/repositories/showsRepo';
import { artwork, hit, motion, space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  Chip,
  Field,
  Icon,
  IconButton,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Text,
  Toast,
} from '@/ui/components';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';
import { Artwork } from '@/ui/Artwork';
import { confirmDestructive } from '@/ui/alerts';
import { useReducedMotion } from '@/ui/useReducedMotion';

interface Loaded {
  show: ShowRow | null;
  layout: ShowLayoutRow | null;
  template: TemplateRow | null;
  assets: AssetRow[];
  /** トークテーマのひな形（FR-SHOW-4）。1 行 1 項目で編集する。 */
  topicTemplate: string;
}

type LayoutSlot = 'opening' | 'ending' | 'bgm';
const SLOT_COL: Record<LayoutSlot, keyof ShowLayoutRow> = {
  opening: 'opening_asset_id',
  ending: 'ending_asset_id',
  bgm: 'bgm_asset_id',
};
const SLOT_GAIN: Record<LayoutSlot, keyof ShowLayoutRow> = {
  opening: 'opening_gain_db',
  ending: 'ending_gain_db',
  bgm: 'bgm_gain_db',
};

/** 概要欄テンプレートに挿入できる変数（DATA_MODEL.md §4.3）。説明は i18n から。 */
const PLACEHOLDER_KEYS = [
  'title',
  'episode_number',
  'season',
  'topics',
  'show_name',
] as const satisfies readonly (keyof Messages['showSettings']['placeholders'])[];

/**
 * 番組設定（FR-SHOW-3, FR-SHOW-4, FR-SHOW-5, FR-META-2）。
 * 先頭の入口から素材管理の子画面へ進み、ここでは番組情報・毎回入れる素材・
 * トークテーマのひな形・概要のひな形を編集する（docs/ux-restructure.md §8）。
 */
export default function ShowScreen() {
  const c = useAppTheme();
  const t = useT();
  const services = useServices();
  const slotLabel = (slot: LayoutSlot) => kindLabel(t, slot);
  const { db, now, assets } = services;
  const showId = services.show.id;
  const { toast, show: showToast, act, dismiss } = useToast();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [artworkBusy, setArtworkBusy] = useState(false);

  const loader = useCallback(async (): Promise<Loaded> => {
    const [show, layout, template, list, topics] = await Promise.all([
      getShow(db, showId),
      getLayout(db, showId),
      getDefaultTemplate(db, showId),
      assets.list(showId),
      services.outline.listTemplate(showId),
    ]);
    return {
      show,
      layout,
      template,
      assets: list,
      topicTemplate: topics.map((x) => x.heading).join('\n'),
    };
  }, [assets, db, services.outline, showId]);
  const { data, reload } = useAsyncData<Loaded>(loader, {
    show: null,
    layout: null,
    template: null,
    assets: [],
    topicTemplate: '',
  });

  // 取り込み（/import）から戻ったときに、上書きされた番組情報を読み直す
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const [editing, setEditing] = useState<'show' | 'topics' | 'template' | null>(null);
  const [showDraft, setShowDraft] = useState<{
    name: string;
    description: string;
    author: string;
    season: string;
  } | null>(null);
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState<LayoutSlot | null>(null);

  const openShowEditor = () => {
    setShowDraft({
      name: data.show?.name ?? '',
      description: data.show?.description ?? '',
      author: data.show?.author ?? '',
      season: String(data.show?.default_season ?? 1),
    });
    setEditing('show');
  };
  const openTopicEditor = () => {
    setTopicDraft(data.topicTemplate);
    setEditing('topics');
  };
  const openTemplateEditor = () => {
    setTemplateDraft(data.template?.body ?? '');
    setEditing('template');
  };
  const closeEditor = () => {
    setEditing(null);
    setShowDraft(null);
    setTopicDraft(null);
    setTemplateDraft(null);
  };

  const saveShowInfo = async () => {
    if (!showDraft) return;
    const season = Math.max(1, parseInt(showDraft.season, 10) || 1);
    await updateShow(
      db,
      showId,
      {
        name: showDraft.name.trim() || t.seed.showName,
        description: showDraft.description,
        author: showDraft.author,
        defaultSeason: season,
      },
      now(),
    );
    await services.reloadShow();
    closeEditor();
    await reload();
    showToast({ text: t.showSettings.showInfoSaved });
  };

  const saveTopics = async () => {
    if (topicDraft === null) return;
    await services.outline.saveTemplate(
      showId,
      splitIntoHeadings(topicDraft).map((heading) => ({ heading, body: '' })),
    );
    closeEditor();
    await reload();
    showToast({ text: t.showSettings.topicTemplateSaved });
  };

  const saveDescriptionTemplate = async () => {
    if (templateDraft === null || !data.template) return;
    await updateTemplate(db, data.template.id, templateDraft, now());
    closeEditor();
    await reload();
    showToast({ text: t.showSettings.descriptionTemplateSaved });
  };

  const pickArtwork = async () => {
    setArtworkBusy(true);
    try {
      const saved = await services.coverArt.pickAndSet(showId);
      if (!saved) return;
      await services.reloadShow();
      await reload();
      showToast({ text: t.showSettings.artworkSaved });
    } catch (e) {
      showToast({ text: errorText(t, e) });
    } finally {
      setArtworkBusy(false);
    }
  };

  const removeArtwork = async () => {
    setArtworkBusy(true);
    try {
      await services.coverArt.remove(showId);
      await services.reloadShow();
      await reload();
      showToast({ text: t.showSettings.artworkRemoved });
    } catch (e) {
      showToast({ text: errorText(t, e) });
    } finally {
      setArtworkBusy(false);
    }
  };

  const setSlot = async (slot: LayoutSlot, assetId: string | null) => {
    setPicking(null);
    const key =
      slot === 'opening' ? 'openingAssetId' : slot === 'ending' ? 'endingAssetId' : 'bgmAssetId';
    await updateLayout(db, showId, { [key]: assetId });
    await reload();
  };

  const bumpGain = async (slot: LayoutSlot, delta: number) => {
    if (!data.layout) return;
    const cur = Number(data.layout[SLOT_GAIN[slot]] ?? 0);
    const next = Math.max(-30, Math.min(6, cur + delta));
    const key =
      slot === 'opening' ? 'openingGainDb' : slot === 'ending' ? 'endingGainDb' : 'bgmGainDb';
    await updateLayout(db, showId, { [key]: next });
    await reload();
  };

  const bumpDuck = async (delta: number) => {
    if (!data.layout) return;
    const next = Math.max(-30, Math.min(0, data.layout.bgm_duck_db + delta));
    await updateLayout(db, showId, { bgmDuckDb: next });
    await reload();
  };

  const assetName = (id: string | null) =>
    data.assets.find((a) => a.id === id)?.name ?? t.showSettings.chooseAsset;
  const pickedId = picking ? ((data.layout?.[SLOT_COL[picking]] as string | null) ?? null) : null;
  const pickList = picking ? data.assets.filter((a) => a.kind === (picking as AssetKind)) : [];

  const openAssets = (kind?: LayoutSlot) => {
    setPicking(null);
    router.push(kind ? { pathname: '/show/assets', params: { kind } } : '/show/assets');
  };

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <ScreenHeader title={t.showSettings.title} subtitle={services.show.name} />

      <SectionHeader title={t.showSettings.showEyebrow} />
      <Card>
        <View style={st.artworkBlock}>
          <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>
            {t.showSettings.artwork}
          </Text>
          <View style={st.artworkRow}>
            <Artwork
              uri={services.coverArt.uri(data.show?.cover_path ?? null)}
              size={artwork.settingsPreview}
              label={t.showSettings.artworkA11y}
              transition={reduced ? 0 : motion.quick}
            />
            <View style={st.artworkActions}>
              <Button
                label={
                  data.show?.cover_path
                    ? t.showSettings.changeArtwork
                    : t.showSettings.chooseArtwork
                }
                kind="secondary"
                icon="show"
                onPress={() => void pickArtwork()}
                busy={artworkBusy}
              />
              {data.show?.cover_path ? (
                <Button
                  label={t.showSettings.removeArtwork}
                  kind="danger"
                  icon="trash"
                  disabled={artworkBusy}
                  onPress={() =>
                    confirmDestructive({
                      title: t.showSettings.removeArtwork,
                      message: t.showSettings.confirmRemoveArtwork,
                      confirmLabel: t.common.delete,
                      cancelLabel: t.common.cancel,
                      onConfirm: () => void removeArtwork(),
                    })
                  }
                />
              ) : null}
            </View>
          </View>
        </View>
        <View style={st.showSummary}>
          <Text style={[typography.heading, { color: c.textPrimary }]}>{data.show?.name}</Text>
          {data.show?.author ? (
            <Text style={[typography.caption, { color: c.textSecondary }]}>{data.show.author}</Text>
          ) : null}
          {data.show?.description ? (
            <Text style={[typography.body, { color: c.textSecondary }]} numberOfLines={3}>
              {data.show.description}
            </Text>
          ) : null}
        </View>
        <Button
          label={t.showSettings.editShowInfo}
          accessibilityLabel={t.showSettings.a11yEditShowInfo}
          icon="edit"
          kind="secondary"
          onPress={openShowEditor}
        />
        <Button
          label={services.show.feed_url ? t.home.reimportShow : t.home.importShow}
          icon="refresh"
          kind="ghost"
          onPress={() => router.push('/import')}
        />
      </Card>

      <SectionHeader title={t.showAssets.title} />
      <Card rows>
        <Row
          icon="music"
          label={t.showAssets.title}
          sub={t.showAssets.count(data.assets.length)}
          accessibilityLabel={t.showAssets.a11yOpen(data.assets.length)}
          onPress={() => openAssets()}
          last
        />
      </Card>

      <SectionHeader title={t.showSettings.layoutEyebrow} />
      <Card style={{ paddingVertical: space.xs }}>
        {(['opening', 'ending', 'bgm'] as LayoutSlot[]).map((slot) => {
          const gain = Number(data.layout?.[SLOT_GAIN[slot]] ?? 0);
          return (
            <View key={slot} style={[st.slot, { borderBottomColor: c.border }]}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={[st.slotLabel, { color: c.textPrimary }]}>{slotLabel(slot)}</Text>
                <Chip
                  icon="music"
                  label={assetName((data.layout?.[SLOT_COL[slot]] as string | null) ?? null)}
                  accessibilityLabel={t.showSettings.a11yPickAsset(slotLabel(slot))}
                  onPress={() => setPicking(slot)}
                />
              </View>
              <Stepper
                label={`${gain > 0 ? '+' : ''}${gain} dB`}
                onMinus={() => bumpGain(slot, -1)}
                onPlus={() => bumpGain(slot, 1)}
                a11y={t.showSettings.a11ySlotGain(slotLabel(slot))}
              />
            </View>
          );
        })}
        <View style={[st.slot, { borderBottomWidth: 0 }]}>
          <Text style={[st.slotLabel, { color: c.textPrimary, flex: 1 }]}>
            {t.showSettings.duckingLabel}
          </Text>
          <Stepper
            label={`${data.layout?.bgm_duck_db ?? -10} dB`}
            onMinus={() => bumpDuck(-1)}
            onPlus={() => bumpDuck(1)}
            a11y={t.showSettings.a11yDuckAmount}
          />
        </View>
      </Card>
      <SectionHeader title={t.showSettings.topicTemplateEyebrow} />
      <Card rows>
        <Row
          label={t.showSettings.topicTemplateEyebrow}
          sub={t.showSettings.topicCount(splitIntoHeadings(data.topicTemplate).length)}
          accessibilityLabel={t.showSettings.a11yEditTopicTemplate}
          onPress={openTopicEditor}
          last
        />
      </Card>

      <SectionHeader title={t.showSettings.templateEyebrow} />
      <Card rows>
        <Row
          label={t.showSettings.templateEyebrow}
          sub={data.template?.body.trim() || t.common.none}
          accessibilityLabel={t.showSettings.a11yEditDescriptionTemplate}
          onPress={openTemplateEditor}
          last
        />
      </Card>

      <Sheet visible={editing === 'show'} onClose={closeEditor} title={t.showSettings.editShowInfo}>
        {showDraft ? (
          <>
            <Field
              label={t.showSettings.name}
              value={showDraft.name}
              onChangeText={(name) => setShowDraft({ ...showDraft, name })}
            />
            <Field
              label={t.showSettings.description}
              value={showDraft.description}
              onChangeText={(description) => setShowDraft({ ...showDraft, description })}
              multiline
            />
            <Field
              label={t.showSettings.author}
              value={showDraft.author}
              onChangeText={(author) => setShowDraft({ ...showDraft, author })}
            />
            <Field
              label={t.showSettings.defaultSeason}
              value={showDraft.season}
              onChangeText={(season) =>
                setShowDraft({ ...showDraft, season: season.replace(/[^0-9]/g, '') })
              }
              keyboardType="number-pad"
            />
            <View style={st.sheetActions}>
              <Button
                label={t.common.save}
                accessibilityLabel={t.showSettings.a11ySaveShowInfo}
                onPress={() => void saveShowInfo()}
              />
              <Button label={t.common.cancel} kind="ghost" onPress={closeEditor} />
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={editing === 'topics'}
        onClose={closeEditor}
        title={t.showSettings.topicTemplateEyebrow}
      >
        {topicDraft !== null ? (
          <>
            <Field
              label={t.showSettings.topicTemplateEyebrow}
              value={topicDraft}
              onChangeText={setTopicDraft}
              multiline
              placeholder={t.showSettings.topicTemplatePlaceholder}
            />
            <View style={st.sheetActions}>
              <Button
                label={t.common.save}
                accessibilityLabel={t.showSettings.a11ySaveTopicTemplate}
                onPress={() => void saveTopics()}
              />
              <Button label={t.common.cancel} kind="ghost" onPress={closeEditor} />
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={editing === 'template'}
        onClose={closeEditor}
        title={t.showSettings.templateEyebrow}
      >
        {templateDraft !== null ? (
          <>
            <Field
              label={t.showSettings.a11yTemplate}
              value={templateDraft}
              onChangeText={setTemplateDraft}
              multiline
            />
            <View style={st.helpWrap}>
              {PLACEHOLDER_KEYS.map((key) => {
                const token = `{{${key}}}`;
                const desc = t.showSettings.placeholders[key];
                return (
                  <Chip
                    key={key}
                    label={desc}
                    accessibilityLabel={t.showSettings.a11yInsertPlaceholder(desc)}
                    onPress={() => setTemplateDraft(`${templateDraft}${token}`)}
                  />
                );
              })}
            </View>
            <View style={st.sheetActions}>
              <Button
                label={t.common.save}
                accessibilityLabel={t.showSettings.a11ySaveDescriptionTemplate}
                onPress={() => void saveDescriptionTemplate()}
              />
              <Button label={t.common.cancel} kind="ghost" onPress={closeEditor} />
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? t.showSettings.slotAssets(slotLabel(picking)) : ''}
        subtitle={picking ? kindLabel(t, picking) : ''}
      >
        <Row
          label={t.common.none}
          onPress={() => picking && setSlot(picking, null)}
          {...(pickedId === null ? { right: <Icon name="check" color={c.accentText} /> } : {})}
        />
        <Row
          icon="plus"
          label={t.showAssets.add}
          accessibilityLabel={picking ? t.showAssets.a11yAdd(slotLabel(picking)) : t.showAssets.add}
          onPress={() => picking && openAssets(picking)}
        />
        {pickList.map((a) => (
          <Row
            key={a.id}
            label={a.name}
            sub={formatSmp(smp(a.duration_smp))}
            onPress={() => picking && setSlot(picking, a.id)}
            {...(pickedId === a.id ? { right: <Icon name="check" color={c.accentText} /> } : {})}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

function Stepper({
  label,
  onMinus,
  onPlus,
  a11y,
}: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  a11y: string;
}) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View style={st.stepper}>
      <IconButton name="minus" label={t.a11y.decrease(a11y)} onPress={onMinus} />
      <Text style={[st.stepValue, { color: c.textPrimary }]}>{label}</Text>
      <IconButton name="plus" label={t.a11y.increase(a11y)} onPress={onPlus} />
    </View>
  );
}

const st = StyleSheet.create({
  artworkBlock: { gap: space.sm, marginBottom: space.lg },
  artworkRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  artworkActions: { flex: 1, minWidth: artwork.settingsPreview, gap: space.sm },
  showSummary: { gap: space.xs, marginBottom: space.lg },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  slotLabel: typography.bodyStrong,
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepValue: { ...typography.numeric, ...tabularNums, minWidth: 64, textAlign: 'center' },
  helpWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sheetActions: { gap: space.sm, marginTop: space.md },
});
