import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatSmp, smp } from '@/domain/time';
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
import { Button, Card, Eyebrow, Header, Row, Screen, Sheet, Toast } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useToast } from '@/ui/useToast';

interface Loaded {
  show: ShowRow | null;
  layout: ShowLayoutRow | null;
  template: TemplateRow | null;
  assets: AssetRow[];
}

type LayoutSlot = 'opening' | 'ending' | 'bgm';
const SLOT_LABEL: Record<LayoutSlot, string> = { opening: 'Opening', ending: 'Ending', bgm: 'BGM' };
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

/** Show の設定・既定構成・概要欄テンプレート（FR-SHOW-3, FR-META-2, DATA_MODEL.md §4.1〜4.3）。 */
export default function ShowSettingsScreen() {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const { db, now, assets } = services;
  const showId = services.show.id;
  const { toast, show: showToast, act, dismiss } = useToast();

  const loader = useCallback(async (): Promise<Loaded> => {
    const [show, layout, template, list] = await Promise.all([
      getShow(db, showId),
      getLayout(db, showId),
      getDefaultTemplate(db, showId),
      assets.list(showId),
    ]);
    return { show, layout, template, assets: list };
  }, [assets, db, showId]);
  const { data, reload } = useAsyncData<Loaded>(loader, {
    show: null,
    layout: null,
    template: null,
    assets: [],
  });

  // 編集中テキスト（保存ボタンで確定）
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    author: string;
    season: string;
    template: string;
  } | null>(null);
  const [picking, setPicking] = useState<LayoutSlot | null>(null);

  const d = draft ?? {
    name: data.show?.name ?? '',
    description: data.show?.description ?? '',
    author: data.show?.author ?? '',
    season: String(data.show?.default_season ?? 1),
    template: data.template?.body ?? '',
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
    data.assets.find((a) => a.id === id)?.name ?? t.common.none;
  const pickList = picking ? data.assets.filter((a) => a.kind === (picking as AssetKind)) : [];

  return (
    <Screen overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Header title={t.showSettings.title} onBack={() => router.back()} />

      <Eyebrow>{t.showSettings.showEyebrow}</Eyebrow>
      <Card>
        <Field label={t.showSettings.name} value={d.name} onChange={(v) => setField('name', v)} />
        <Field
          label={t.showSettings.description}
          value={d.description}
          onChange={(v) => setField('description', v)}
          multiline
        />
        <Field
          label={t.showSettings.author}
          value={d.author}
          onChange={(v) => setField('author', v)}
        />
        <Field
          label={t.showSettings.defaultSeason}
          value={d.season}
          onChange={(v) => setField('season', v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />
        <Row label={t.showSettings.coverArt} sub={t.showSettings.coverArtSub} />
      </Card>

      <Eyebrow>{t.showSettings.layoutEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: 4 }}>
        {(['opening', 'ending', 'bgm'] as LayoutSlot[]).map((slot) => {
          const gain = Number(data.layout?.[SLOT_GAIN[slot]] ?? 0);
          return (
            <View key={slot} style={[st.slot, { borderBottomColor: c.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={[st.slotLabel, { color: c.ink }]}>{SLOT_LABEL[slot]}</Text>
                <Pressable
                  onPress={() => setPicking(slot)}
                  accessibilityRole="button"
                  accessibilityLabel={t.showSettings.a11yPickAsset(SLOT_LABEL[slot])}
                >
                  <Text style={{ color: c.accent, fontSize: 13, marginTop: 3 }}>
                    {assetName((data.layout?.[SLOT_COL[slot]] as string | null) ?? null)} ›
                  </Text>
                </Pressable>
              </View>
              <Stepper
                label={`${gain > 0 ? '+' : ''}${gain} dB`}
                onMinus={() => bumpGain(slot, -1)}
                onPlus={() => bumpGain(slot, 1)}
                a11y={t.showSettings.a11ySlotGain(SLOT_LABEL[slot])}
              />
            </View>
          );
        })}
        <View style={[st.slot, { borderBottomWidth: 0 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[st.slotLabel, { color: c.ink }]}>{t.showSettings.duckingLabel}</Text>
            <Text style={{ color: c.ink2, fontSize: 12, marginTop: 3 }}>
              {t.showSettings.duckingSub}
            </Text>
          </View>
          <Stepper
            label={`${data.layout?.bgm_duck_db ?? -10} dB`}
            onMinus={() => bumpDuck(-1)}
            onPlus={() => bumpDuck(1)}
            a11y={t.showSettings.a11yDuckAmount}
          />
        </View>
      </Card>
      <Pressable onPress={() => router.push('/show/assets')} accessibilityRole="button">
        <Text style={{ color: c.accent, fontSize: 13, marginBottom: 8 }}>
          {t.showSettings.assetsLink}
        </Text>
      </Pressable>

      <Eyebrow>{t.showSettings.templateEyebrow}</Eyebrow>
      <Card>
        <Text style={{ color: c.ink2, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
          {t.showSettings.templateNote}
        </Text>
        <TextInput
          value={d.template}
          onChangeText={(v) => setField('template', v)}
          multiline
          accessibilityLabel={t.showSettings.a11yTemplate}
          style={[
            st.input,
            st.multiline,
            { color: c.ink, borderColor: c.line, backgroundColor: c.panel2 },
          ]}
        />
        <View style={st.helpWrap}>
          {PLACEHOLDER_KEYS.map((key) => {
            const token = `{{${key}}}`;
            const desc = t.showSettings.placeholders[key];
            return (
              <Pressable
                key={key}
                onPress={() => setField('template', `${d.template}${token}`)}
                accessibilityRole="button"
                accessibilityLabel={t.showSettings.a11yInsertPlaceholder(desc)}
              >
                <Text style={[st.help, { color: c.ink2, borderColor: c.line }]}>
                  <Text style={{ color: c.accent }}>{token}</Text> {desc}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Button label={t.common.save} onPress={save} disabled={!draft} />

      <Sheet
        visible={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? t.showSettings.slotAssets(SLOT_LABEL[picking]) : ''}
        subtitle={picking ? kindLabel(t, picking) : ''}
      >
        <Row label={t.common.none} onPress={() => picking && setSlot(picking, null)} />
        {pickList.map((a) => (
          <Row
            key={a.id}
            label={a.name}
            sub={formatSmp(smp(a.duration_smp))}
            onPress={() => picking && setSlot(picking, a.id)}
          />
        ))}
        {picking && pickList.length === 0 ? (
          <Text style={{ color: c.ink3, paddingVertical: 12 }}>
            {t.showSettings.noAssetsForSlot}
          </Text>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
}) {
  const c = useAppTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: c.ink2, fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType ?? 'default'}
        accessibilityLabel={label}
        style={[
          st.input,
          multiline ? st.multiline : null,
          { color: c.ink, borderColor: c.line, backgroundColor: c.panel2 },
        ]}
      />
    </View>
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
      <Pressable
        onPress={onMinus}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t.a11y.decrease(a11y)}
        style={[st.stepBtn, { borderColor: c.line }]}
      >
        <Text style={{ color: c.ink }}>−</Text>
      </Pressable>
      <Text style={[st.stepValue, { color: c.ink }]}>{label}</Text>
      <Pressable
        onPress={onPlus}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t.a11y.increase(a11y)}
        style={[st.stepBtn, { borderColor: c.line }]}
      >
        <Text style={{ color: c.ink }}>＋</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  slotLabel: { fontSize: 15, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'], fontSize: 13 },
  helpWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  help: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
});
