import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
import { splitIntoHeadings } from '@/domain/outline';
import { useServices } from '@/features/app/ServicesProvider';
import { kindLabel } from '@/features/show/assetKinds';
import { useAsyncData } from '@/features/show/useAsyncData';
import { useT, type Messages } from '@/i18n';
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
import { hit, space, tabularNums, typography } from '@/ui/tokens';
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

  // 編集中テキスト（保存ボタンで確定）
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    author: string;
    season: string;
    template: string;
    topicTemplate: string;
  } | null>(null);
  const [picking, setPicking] = useState<LayoutSlot | null>(null);

  const d = draft ?? {
    name: data.show?.name ?? '',
    description: data.show?.description ?? '',
    author: data.show?.author ?? '',
    season: String(data.show?.default_season ?? 1),
    template: data.template?.body ?? '',
    topicTemplate: data.topicTemplate,
  };
  const setField = (k: keyof typeof d, v: string) => setDraft({ ...d, [k]: v });

  const save = async () => {
    const season = Math.max(1, parseInt(d.season, 10) || 1);
    await updateShow(
      db,
      showId,
      {
        name: d.name.trim() || t.seed.showName,
        description: d.description,
        author: d.author,
        defaultSeason: season,
      },
      now(),
    );
    if (data.template) await updateTemplate(db, data.template.id, d.template, now());
    await services.outline.saveTemplate(
      showId,
      splitIntoHeadings(d.topicTemplate).map((heading) => ({ heading, body: '' })),
    );
    await services.reloadShow();
    setDraft(null);
    await reload();
    showToast({ text: t.showSettings.saved });
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

      <Card style={{ paddingVertical: space.xs }}>
        <Row
          icon="music"
          label={t.showAssets.title}
          sub={t.showAssets.count(data.assets.length)}
          accessibilityLabel={t.showAssets.a11yOpen(data.assets.length)}
          onPress={() => openAssets()}
          last
        />
      </Card>

      <SectionHeader title={t.showSettings.showEyebrow} />
      <Card>
        <Field
          label={t.showSettings.name}
          value={d.name}
          onChangeText={(v) => setField('name', v)}
        />
        <Field
          label={t.showSettings.description}
          value={d.description}
          onChangeText={(v) => setField('description', v)}
          multiline
        />
        <Field
          label={t.showSettings.author}
          value={d.author}
          onChangeText={(v) => setField('author', v)}
        />
        <Field
          label={t.showSettings.defaultSeason}
          value={d.season}
          onChangeText={(v) => setField('season', v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />
        <Button
          label={services.show.feed_url ? t.home.reimportShow : t.home.importShow}
          icon="refresh"
          kind="ghost"
          onPress={() => router.push('/import')}
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
      <Card>
        <Field
          label={t.showSettings.topicTemplateEyebrow}
          value={d.topicTemplate}
          onChangeText={(v) => setField('topicTemplate', v)}
          multiline
          placeholder={t.showSettings.topicTemplatePlaceholder}
        />
      </Card>

      <SectionHeader title={t.showSettings.templateEyebrow} />
      <Card>
        <Field
          label={t.showSettings.a11yTemplate}
          value={d.template}
          onChangeText={(v) => setField('template', v)}
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
                onPress={() => setField('template', `${d.template}${token}`)}
              />
            );
          })}
        </View>
      </Card>

      <Button label={t.common.save} onPress={save} disabled={!draft} />

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
});
