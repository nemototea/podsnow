import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { compositeHex } from '@/domain/color/showColors';
import {
  insertAtSelection,
  previewTemplate,
  TEMPLATE_VARS,
  type TemplateVar,
  type TextSelection,
} from '@/domain/metadata/template';
import { htmlToPlainText } from '@/domain/podcast/parseFeed';
import { APPLE_CATEGORIES, SHOW_LANGUAGES, subcategoriesOf } from '@/domain/podcast/categories';
import { categoryNames, primaryLanguage, showWebsite } from '@/domain/podcast/showInfo';
import { formatSmp, smp } from '@/domain/time';
import { useServices } from '@/features/app/ServicesProvider';
import { episodeStatusKind, type EpisodeStatusKind } from '@/features/home/statusIcon';
import { useEpisodeActions } from '@/features/home/useEpisodeActions';
import { useHome } from '@/features/home/useHome';
import { usePlaybackStatus } from '@/features/player/usePlayback';
import { kindLabel } from '@/features/show/assetKinds';
import { useAssetPreview } from '@/features/show/useAssetPreview';
import { useAsyncData } from '@/features/show/useAsyncData';
import {
  draftFromInfo,
  patchFromDraft,
  patchFromInfo,
  type ShowInfoDraft,
} from '@/features/show/showInfoDraft';
import { useShowColors } from '@/features/show/useShowColors';
import { episodeName, errorText, formatShortDate, useLocale, useT, type Messages } from '@/i18n';
import type { AssetKind, AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { ShowLayoutRow, TemplateRow } from '@/infra/db/repositories/showsRepo';
import type { ShowInfo, ShowInfoPatch } from '@/services/shows/ShowService';
import { confirmDestructive } from '@/ui/alerts';
import { Artwork } from '@/ui/Artwork';
import { Avatar } from '@/ui/Avatar';
import { ChoiceMenu } from '@/ui/ChoiceMenu';
import { CircleButton } from '@/ui/CircleButton';
import {
  Button,
  Chip,
  Field,
  Icon,
  IconButton,
  Pill,
  Row,
  Screen,
  Text,
  Toggle,
  Toast,
  useGutter,
} from '@/ui/components';
import type { IconName } from '@/ui/IconSvg';
import type { MenuAction } from '@/ui/menuTypes';
import { MoreMenu } from '@/ui/MoreMenu';
import { Sheet } from '@/ui/Sheet';
import { ShowGradient } from '@/ui/ShowGradient';
import { useAppTheme } from '@/ui/ThemeContext';
import {
  artwork,
  hit,
  hitSlop,
  icon,
  motion,
  pressedOpacity,
  space,
  stroke,
  typography,
} from '@/ui/tokens';
import { useReducedMotion } from '@/ui/useReducedMotion';
import { useToast } from '@/ui/useToast';

/** 同じ日か（端末の暦で）。 */
function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** 著者の行と操作の白の濃さ（見本 `.showhead .by`、`.actions .ib` の 75%）。 */
const BY_ALPHA = 0.75;

/** 番組の紹介を畳んだときの行数（見本 `.showhead .about p` の 3 行。Issue #259）。 */
const ABOUT_LINES = 3;

/** 一覧の切り替え（見本 `.eplist .chip`「エピソード / 素材 / ひな形」）。 */
const SECTIONS = ['episodes', 'assets', 'templates'] as const;
type Section = (typeof SECTIONS)[number];

function isSection(v: string | undefined): v is Section {
  return SECTIONS.some((s) => s === v);
}

function statusLabel(t: Messages, kind: EpisodeStatusKind): string {
  switch (kind) {
    case 'published':
      return t.home.badgePublished;
    case 'noAudio':
      return t.home.badgeNoAudio;
    case 'new':
      return t.home.badgeNew;
    default:
      return t.status[kind];
  }
}

interface Loaded {
  /** 番組情報とカテゴリーの並び（FR-SHOW-3、FR-SHOW-3a）。 */
  info: ShowInfo | null;
  layout: ShowLayoutRow | null;
  template: TemplateRow | null;
  assets: AssetRow[];
  /** カンペのひな形（FR-SHOW-4）。1 つの文章。 */
  notesTemplate: string;
}

type LayoutSlot = 'opening' | 'ending' | 'bgm';
const SLOT_COL: Record<LayoutSlot, keyof ShowLayoutRow> = {
  opening: 'opening_asset_id',
  ending: 'ending_asset_id',
  bgm: 'bgm_asset_id',
};

/** 概要欄テンプレートに挿入できる変数（DATA_MODEL.md §4.3）。説明は i18n から。 */
const PLACEHOLDER_KEYS =
  TEMPLATE_VARS satisfies readonly (keyof Messages['showSettings']['placeholders'])[];

/**
 * 番組設定（FR-SHOW-3, FR-SHOW-4, FR-SHOW-5, FR-META-2）。
 * 先頭の入口から素材管理の子画面へ進み、ここでは番組情報・毎回入れる素材・
 * カンペのひな形・概要のひな形を編集する（docs/ux-restructure.md §8）。
 */
export default function ShowScreen() {
  const c = useAppTheme();
  const t = useT();
  const services = useServices();
  const slotLabel = (slot: LayoutSlot) => kindLabel(t, slot);
  const { assets, shows } = services;
  const showId = services.show.id;
  const { toast, show: showToast, act, dismiss } = useToast();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [artworkBusy, setArtworkBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  const locale = useLocale();
  const colors = useShowColors();
  const player = usePlaybackStatus();
  const { list, playable, reload: reloadList } = useHome();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(
    isSection(params.section) ? params.section : 'episodes',
  );
  const [creating, setCreating] = useState(false);
  // 「今日」の判定に使う。開いたときの日付で決める
  const [today] = useState(() => Date.now());
  const notify = useCallback((text: string) => showToast({ text }), [showToast]);
  const episodeActions = useEpisodeActions(reloadList, notify);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const ep = await services.episodes.create(showId);
      router.push(`/episode/${ep.id}`);
    } finally {
      setCreating(false);
    }
  };

  const loader = useCallback(async (): Promise<Loaded> => {
    const [info, layout, template, list, notesTemplate] = await Promise.all([
      shows.getInfo(showId),
      shows.getLayout(showId),
      shows.getDescriptionTemplate(showId),
      assets.list(showId),
      services.notes.getTemplate(showId),
    ]);
    return { info, layout, template, assets: list, notesTemplate };
  }, [assets, services.notes, shows, showId]);
  const { data, reload } = useAsyncData<Loaded>(loader, {
    info: null,
    layout: null,
    template: null,
    assets: [],
    notesTemplate: '',
  });
  const show = data.info?.show ?? null;

  // 取り込み（/import）から戻ったときに、上書きされた番組情報を読み直す
  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadList();
    }, [reload, reloadList]),
  );

  const [editing, setEditing] = useState<'show' | 'notes' | 'template' | null>(null);
  const [showDraft, setShowDraft] = useState<ShowInfoDraft | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState<LayoutSlot | null>(null);
  const { playingId: previewingId, toggle: togglePreview, stop: stopPreview } = useAssetPreview();
  // 概要欄テンプレートの選択範囲。差し込みはここに入れる（Issue #174 F2）
  const templateSel = useRef<TextSelection | null>(null);
  // 差し込んだ直後だけカーソルを指定し、次の選択の変化で手放す（常に制御すると入力が引っかかる）
  const [forcedSel, setForcedSel] = useState<TextSelection | null>(null);

  const openShowEditor = () => {
    if (!data.info) return;
    setShowDraft(draftFromInfo(data.info));
    setEditing('show');
  };
  const openNotesEditor = () => {
    setNotesDraft(data.notesTemplate);
    setEditing('notes');
  };
  const openTemplateEditor = () => {
    templateSel.current = null;
    setForcedSel(null);
    setTemplateDraft(data.template?.body ?? '');
    setEditing('template');
  };
  const closeEditor = () => {
    setEditing(null);
    setShowDraft(null);
    setNotesDraft(null);
    setTemplateDraft(null);
  };

  /**
   * 番組情報のシートは、閉じたとき（完了・✕・背景・下スワイプ）に変更があれば保存する（Issue #167）。
   * iOS のページシートは下スワイプで閉じ終わってから知らされるので、閉じる前の確認は出せない。
   * 代わりに保存したことを伝え、取り消しで元に戻せるようにする。
   */
  const closeShowEditor = async () => {
    const draft = showDraft;
    const before = data.info;
    closeEditor();
    if (!draft || !before) return;
    const next = patchFromDraft(draft, before, t.seed.showName);
    if (!next) return;
    const prev = patchFromInfo(before);
    const write = async (v: ShowInfoPatch) => {
      await shows.updateInfo(showId, v);
      await services.reloadShow();
      await reload();
    };
    await write(next);
    showToast({
      text: t.showSettings.showInfoSaved,
      action: t.common.undo,
      onAction: () => void write(prev),
    });
  };

  const saveNotes = async () => {
    if (notesDraft === null) return;
    await services.notes.saveTemplate(showId, notesDraft);
    closeEditor();
    await reload();
    showToast({ text: t.showSettings.notesTemplateSaved });
  };

  const insertPlaceholder = (key: TemplateVar) => {
    if (templateDraft === null) return;
    const r = insertAtSelection(templateDraft, templateSel.current, `{{${key}}}`);
    const cursor = { start: r.cursor, end: r.cursor };
    templateSel.current = cursor;
    setTemplateDraft(r.text);
    setForcedSel(cursor);
  };

  const saveDescriptionTemplate = async () => {
    if (templateDraft === null || !data.template) return;
    await shows.updateDescriptionTemplate(data.template.id, templateDraft);
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
    stopPreview();
    const key =
      slot === 'opening' ? 'openingAssetId' : slot === 'ending' ? 'endingAssetId' : 'bgmAssetId';
    await shows.updateLayout(showId, { [key]: assetId });
    await reload();
  };

  // 編集シートの選択肢（Issue #259）。今の値が一覧に無い（古い分類・一覧外の言語）ときも選択肢に残す
  const categoryOptions = (current: string) => [
    { value: '', label: t.common.notSet },
    ...[
      ...APPLE_CATEGORIES.map((g) => g.name),
      ...(current && !APPLE_CATEGORIES.some((g) => g.name === current) ? [current] : []),
    ].map((name) => ({ value: name, label: t.showSettings.categoryName(name) })),
  ];
  const subcategoryChoices = ({
    category,
    subcategory,
  }: {
    category: string;
    subcategory: string;
  }) => {
    const subs = subcategoriesOf(category);
    return subcategory && !subs.includes(subcategory) ? [...subs, subcategory] : subs;
  };
  const languageLabel = (code: string) =>
    primaryLanguage(code) ? t.showSettings.languageName(primaryLanguage(code)) : t.common.notSet;
  const languageOptions = (current: string) => {
    const cur = primaryLanguage(current);
    const codes: string[] = [...SHOW_LANGUAGES];
    if (cur && !codes.includes(cur)) codes.push(cur);
    return [
      { value: '', label: t.common.notSet },
      ...codes.map((code) => ({ value: code, label: t.showSettings.languageName(code) })),
    ];
  };

  // 見出しと同じ文字を行に繰り返さず、行には値（先頭 1 行・件数）を出す（Issue #174 F3）
  const placeholderNames = Object.fromEntries(
    PLACEHOLDER_KEYS.map((k) => [
      k,
      t.showSettings.placeholderToken(t.showSettings.placeholders[k]),
    ]),
  ) as Record<TemplateVar, string>;
  const notesLines = data.notesTemplate.split('\n').filter((l) => l.trim());
  const notesRow = {
    label: notesLines[0]?.trim() ?? t.common.none,
    sub: notesLines.length ? t.showSettings.templateLines(notesLines.length) : null,
  };
  const templateBody = data.template?.body.trim() ?? '';
  const templateLines = templateBody ? templateBody.split('\n') : [];
  const templateRow = {
    label: templateLines[0] ? previewTemplate(templateLines[0], placeholderNames) : t.common.none,
    sub: templateLines.length ? t.showSettings.templateLines(templateLines.length) : null,
  };
  const rowA11y = (action: string, row: { label: string; sub: string | null }) =>
    [action, row.label, row.sub].filter(Boolean).join(', ');

  /** 枠に選んである素材。消された素材を指していれば未選択とみなす。 */
  const slotAsset = (slot: LayoutSlot) => {
    const id = (data.layout?.[SLOT_COL[slot]] as string | null) ?? null;
    return id ? (data.assets.find((a) => a.id === id) ?? null) : null;
  };
  const pickedId = picking ? ((data.layout?.[SLOT_COL[picking]] as string | null) ?? null) : null;
  const pickList = picking ? data.assets.filter((a) => a.kind === (picking as AssetKind)) : [];

  const openAssets = (kind?: LayoutSlot) => {
    setPicking(null);
    stopPreview();
    router.push(kind ? { pathname: '/show/assets', params: { kind } } : '/show/assets');
  };

  const cover = services.coverArt.uri(show?.cover_path ?? null);
  const showName = show?.name ?? services.show.name;
  const author = show?.author ?? '';
  // 番組の紹介と詳細（Issue #259）。取り込んだ概要は HTML のことがあるので文にする
  const about = show ? htmlToPlainText(show.description) : null;
  const website = showWebsite(show?.website_url ?? '');
  const categories = categoryNames(data.info?.categories ?? []);
  const explicit = show?.explicit === 1;
  const languageCode = primaryLanguage(show?.language ?? '');
  const language = languageCode ? t.showSettings.languageName(languageCode) : '';
  const by = compositeHex(c.textPrimary, BY_ALPHA, colors.header);
  const actionColor = compositeHex(c.textPrimary, BY_ALPHA, colors.header);

  const showMenu: MenuAction[] = [
    {
      key: 'artwork',
      icon: 'artwork',
      label: show?.cover_path ? t.showSettings.changeArtwork : t.showSettings.chooseArtwork,
      onPress: () => void pickArtwork(),
    },
    ...(show?.cover_path
      ? [
          {
            key: 'removeArtwork',
            icon: 'trash' as const,
            label: t.showSettings.removeArtwork,
            destructive: true,
            onPress: () =>
              confirmDestructive({
                title: t.showSettings.removeArtwork,
                message: t.showSettings.confirmRemoveArtwork,
                confirmLabel: t.common.delete,
                cancelLabel: t.common.cancel,
                onConfirm: () => void removeArtwork(),
              }),
          },
        ]
      : []),
    {
      key: 'import',
      icon: 'refresh',
      label: services.show.feed_url ? t.home.reimportShow : t.home.importShow,
      onPress: () => router.push('/import'),
    },
  ];

  return (
    <Screen padded={false} overlay={<Toast toast={toast} onAction={act} onDismiss={dismiss} />}>
      <Stack.Screen options={{ headerShown: false, title: showName }} />

      {/* 見本 `.showhead`: 番組の色から地の色へのグラデーション（DESIGN_SYSTEM.md §2.6） */}
      <View style={[st.head, { paddingTop: insets.top + space.x10, paddingHorizontal: gutter }]}>
        <ShowGradient
          stops={[
            [colors.header, 0],
            [colors.headerEnd, 0.48],
            [c.bg, 1],
          ]}
        />
        <View style={st.headTop}>
          <IconButton
            name="back"
            color={c.textPrimary}
            label={t.a11y.back}
            onPress={() => router.back()}
          />
          <IconButton
            name="search"
            color={c.textPrimary}
            label={t.tabs.search}
            onPress={() => router.push('/search')}
          />
        </View>
        <View style={st.cover}>
          <Artwork
            uri={cover}
            name={showName}
            size={artwork.showHeader}
            label={t.showSettings.artworkA11y}
            transition={reduced ? 0 : motion.quick}
            shadow="large"
          />
        </View>
        {/* 長い番組名は 3 行で省略し、全文は読み上げる（Issue #261） */}
        <Text
          style={[typography.display, st.name, { color: c.textPrimary }]}
          accessibilityRole="header"
          numberOfLines={3}
          accessibilityLabel={showName}
        >
          {showName}
        </Text>
        <View style={st.by}>
          {author ? (
            <>
              <Avatar name={author} size="sm" />
              {/* 縮めて省略し、「· N 本」を画面の外へ押し出さない（Issue #261） */}
              <Text
                style={[typography.chipStrong, st.shrink, { color: c.textPrimary }]}
                numberOfLines={1}
                accessibilityLabel={author}
              >
                {author}
              </Text>
              <Text style={[typography.byline, { color: by }]}>·</Text>
            </>
          ) : null}
          <Text style={[typography.byline, { color: by }]}>
            {t.home.showCardCount(list.length)}
          </Text>
        </View>
        {about === null ? null : (
          <ShowAbout key={about} text={about} color={by} onWrite={openShowEditor} />
        )}
        {categories.length || website || language || explicit ? (
          <View style={st.facts}>
            {categories.length ? (
              <View style={st.cats}>
                {categories.map((name) => (
                  <Chip key={name} label={t.showSettings.categoryName(name)} />
                ))}
              </View>
            ) : null}
            {website || language || explicit ? (
              <View style={st.meta}>
                {/* 見本 `.showhead .meta .pill`: 露骨な表現を含む番組の「E」（itunes:explicit） */}
                {explicit ? (
                  <Pill
                    label={t.showSettings.explicitBadge}
                    kind="strong"
                    accessibilityLabel={t.showSettings.explicit}
                  />
                ) : null}
                {website ? (
                  <Pressable
                    onPress={() => void Linking.openURL(website.href).catch(() => undefined)}
                    accessibilityRole="link"
                    accessibilityLabel={t.showSettings.a11yOpenWebsite(website.label)}
                    hitSlop={hitSlop(typography.captionStrong.lineHeight)}
                    style={({ pressed }) => [st.site, pressed ? { opacity: pressedOpacity } : null]}
                  >
                    <Icon name="link" color={c.textPrimary} size={icon.inline} />
                    <Text
                      style={[typography.captionStrong, st.shrink, { color: c.textPrimary }]}
                      numberOfLines={1}
                    >
                      {website.label}
                    </Text>
                  </Pressable>
                ) : null}
                {website && language ? (
                  <Text style={[typography.caption, { color: by }]}>·</Text>
                ) : null}
                {language ? (
                  <Text
                    style={[typography.caption, { color: by }]}
                    accessibilityLabel={t.showSettings.a11yLanguage(language)}
                  >
                    {language}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={st.actions}>
          <IconButton
            name="edit"
            color={actionColor}
            label={t.showSettings.a11yEditShowInfo}
            onPress={openShowEditor}
          />
          <IconButton
            name="share"
            color={actionColor}
            label={t.showSettings.a11yShareShow}
            onPress={() =>
              void Share.share({
                message: [showName, services.show.feed_url].filter(Boolean).join('\n'),
              }).catch(() => undefined)
            }
          />
          <MoreMenu
            label={t.showSettings.a11yShowMenu}
            title={showName}
            actions={showMenu}
            color={actionColor}
            disabled={artworkBusy}
          />
          <View style={st.grow} />
          <CircleButton
            kind="accent"
            name="mic"
            label={t.showSettings.newEpisode}
            busy={creating}
            onPress={() => void create()}
          />
        </View>
      </View>

      <View style={[st.body, { paddingHorizontal: gutter }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.chips}
        >
          {SECTIONS.map((key) => (
            <Chip
              key={key}
              label={t.showSettings.sections[key]}
              active={section === key}
              onPress={() => setSection(key)}
            />
          ))}
        </ScrollView>

        {section === 'episodes'
          ? list.map((item) => {
              const e = item.local;
              const kind = episodeStatusKind(item);
              const done = kind === 'exported' || kind === 'published';
              const at = e?.recorded_at ?? item.publishedAt ?? e?.created_at ?? null;
              const desc = item.feed?.description
                ? htmlToPlainText(item.feed.description)
                : (e?.description.trim() ?? '');
              const label = episodeName(t, item.title);
              const active = player.source?.homeKey === item.key;
              const canPlay = playable.has(item.key);
              return (
                <View key={item.key} style={[st.epi, { borderBottomColor: c.border }]}>
                  <Pressable
                    onPress={() => (e ? router.push(`/episode/${e.id}`) : undefined)}
                    disabled={!e}
                    accessibilityRole={e ? 'button' : undefined}
                    accessibilityLabel={[label, statusLabel(t, kind), desc]
                      .filter(Boolean)
                      .join(', ')}
                    style={({ pressed }) => [
                      st.epiText,
                      pressed ? { opacity: pressedOpacity } : null,
                    ]}
                  >
                    <View style={st.epiDate}>
                      {done ? null : <Pill label={statusLabel(t, kind)} />}
                      {at === null ? null : (
                        <Text style={[typography.small, { color: c.textSecondary }]}>
                          {/* 見本 `.epi .d`: 下書きは「今日」、書き出し済みは「9月27日 · 29分」 */}
                          {[
                            sameDay(at, today) ? t.showSettings.today : formatShortDate(at, locale),
                            done
                              ? t.showSettings.minutes(
                                  Math.max(1, Math.round(item.durationSmp / 48000 / 60)),
                                )
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[
                        typography.rowTitleStrong,
                        { color: item.title ? c.textPrimary : c.textSecondary },
                      ]}
                    >
                      {label}
                    </Text>
                    {desc ? (
                      <Text
                        style={[typography.caption, { color: c.textSecondary }]}
                        numberOfLines={2}
                      >
                        {desc}
                      </Text>
                    ) : null}
                  </Pressable>
                  <View style={st.ctl}>
                    {e ? (
                      done ? (
                        <IconButton
                          name="share"
                          label={t.showSettings.a11yShareEpisode(label)}
                          onPress={() => router.push(`/episode/${e.id}/share`)}
                        />
                      ) : (
                        <IconButton
                          name="edit"
                          label={t.showSettings.a11yEditEpisode(label)}
                          onPress={() => router.push(`/episode/${e.id}`)}
                        />
                      )
                    ) : null}
                    {e ? (
                      <MoreMenu
                        label={t.home.a11yEpisodeMenu(episodeName(t, e.title))}
                        title={label}
                        actions={episodeActions(e)}
                      />
                    ) : null}
                    <View style={st.grow} />
                    <Text style={[typography.small, st.dur, { color: c.textSecondary }]}>
                      {done
                        ? statusLabel(t, kind)
                        : e?.audio_purged_at
                          ? t.home.badgeNoAudio
                          : formatSmp(smp(item.durationSmp))}
                    </Text>
                    {e && !done ? (
                      <CircleButton
                        name="mic"
                        label={t.home.miniRecord}
                        onPress={() => router.push(`/episode/${e.id}`)}
                      />
                    ) : canPlay ? (
                      <CircleButton
                        name={active && player.playing ? 'pause' : 'play'}
                        label={active && player.playing ? t.a11y.pause : t.a11y.play}
                        busy={active && player.loading}
                        onPress={() => void player.toggleHome(item)}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })
          : null}

        {section === 'assets' ? (
          <>
            <ListRow
              icon={data.assets.length ? 'music' : 'plus'}
              label={data.assets.length ? t.showAssets.count(data.assets.length) : t.showAssets.add}
              accessibilityLabel={t.showAssets.a11yOpen(data.assets.length)}
              onPress={() => openAssets()}
            />
            <Text
              style={[typography.subheading, st.subheading, { color: c.textPrimary }]}
              accessibilityRole="header"
            >
              {t.showSettings.layoutEyebrow}
            </Text>
            {(['opening', 'ending', 'bgm'] as LayoutSlot[]).map((slot) => {
              const asset = slotAsset(slot);
              const previewing = !!asset && previewingId === asset.id;
              return (
                <View key={slot} style={[st.slot, { borderBottomColor: c.border }]}>
                  <View style={st.slotText}>
                    <Text style={[typography.fieldLabel, { color: c.textSecondary }]}>
                      {slotLabel(slot)}
                    </Text>
                    <View style={st.slotPick}>
                      <Chip
                        icon="music"
                        label={asset?.name ?? t.showSettings.chooseAsset}
                        accessibilityLabel={t.showSettings.a11yPickAsset(slotLabel(slot))}
                        onPress={() => setPicking(slot)}
                      />
                      {asset ? (
                        <IconButton
                          name={previewing ? 'stop' : 'play'}
                          label={
                            previewing
                              ? t.showSettings.a11yStopSlotPreview(slotLabel(slot))
                              : t.showSettings.a11ySlotPreview(slotLabel(slot))
                          }
                          selected={previewing}
                          onPress={() => void togglePreview(asset)}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })}
            {/* 音量・配置・フェード・下げ幅はエピソードで聞いて決めて写す（Issue #263） */}
            <Text style={[typography.caption, st.layoutNote, { color: c.textSecondary }]}>
              {t.showSettings.layoutDefaultsNote}
            </Text>
          </>
        ) : null}

        {section === 'templates' ? (
          <>
            <ListRow
              heading={t.showSettings.notesTemplateEyebrow}
              label={notesRow.label}
              muted={!notesLines.length}
              {...(notesRow.sub ? { sub: notesRow.sub } : {})}
              accessibilityLabel={rowA11y(t.showSettings.a11yEditNotesTemplate, notesRow)}
              onPress={openNotesEditor}
            />
            <ListRow
              heading={t.showSettings.templateEyebrow}
              label={templateRow.label}
              muted={!templateLines.length}
              {...(templateRow.sub ? { sub: templateRow.sub } : {})}
              accessibilityLabel={rowA11y(t.showSettings.a11yEditDescriptionTemplate, templateRow)}
              onPress={openTemplateEditor}
            />
          </>
        ) : null}
      </View>

      <Sheet
        visible={editing === 'show'}
        onClose={() => void closeShowEditor()}
        title={t.showSettings.editShowInfo}
      >
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
              label={t.showSettings.website}
              value={showDraft.websiteUrl}
              onChangeText={(websiteUrl) => setShowDraft({ ...showDraft, websiteUrl })}
              placeholder={t.showSettings.websitePlaceholder}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="URL"
            />
            <ChoiceMenu
              label={t.showSettings.category}
              sub={
                showDraft.primary.category
                  ? t.showSettings.categoryName(showDraft.primary.category)
                  : t.common.notSet
              }
              title={t.showSettings.category}
              value={showDraft.primary.category}
              options={categoryOptions(showDraft.primary.category)}
              onChange={(category) =>
                setShowDraft({
                  ...showDraft,
                  primary: {
                    category,
                    // 主を変えたら副は選び直す（別の主の副は付けられない）
                    subcategory:
                      category === showDraft.primary.category ? showDraft.primary.subcategory : '',
                  },
                })
              }
            />
            {subcategoryChoices(showDraft.primary).length ? (
              <ChoiceMenu
                label={t.showSettings.subcategory}
                sub={
                  showDraft.primary.subcategory
                    ? t.showSettings.categoryName(showDraft.primary.subcategory)
                    : t.common.none
                }
                title={t.showSettings.subcategory}
                value={showDraft.primary.subcategory}
                options={[
                  { value: '', label: t.common.none },
                  ...subcategoryChoices(showDraft.primary).map((name) => ({
                    value: name,
                    label: t.showSettings.categoryName(name),
                  })),
                ]}
                onChange={(subcategory) =>
                  setShowDraft({ ...showDraft, primary: { ...showDraft.primary, subcategory } })
                }
              />
            ) : null}
            <ChoiceMenu
              label={t.showSettings.language}
              sub={languageLabel(showDraft.language)}
              title={t.showSettings.language}
              value={primaryLanguage(showDraft.language)}
              options={languageOptions(showDraft.language)}
              onChange={(code) =>
                // 同じ言語を選び直しただけなら、地域つきの元の値（en-us など）を残す
                code !== primaryLanguage(showDraft.language)
                  ? setShowDraft({ ...showDraft, language: code })
                  : undefined
              }
            />
            <Row
              label={t.showSettings.explicit}
              info={t.glossary.explicit}
              last
              right={
                <Toggle
                  accessibilityLabel={t.showSettings.explicit}
                  value={showDraft.explicit}
                  onChange={(explicit) => setShowDraft({ ...showDraft, explicit })}
                />
              }
            />
            <View style={st.sheetActions}>
              <Button
                label={t.common.done}
                accessibilityLabel={t.showSettings.a11ySaveShowInfo}
                onPress={() => void closeShowEditor()}
              />
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={editing === 'notes'}
        onClose={closeEditor}
        title={t.showSettings.notesTemplateEyebrow}
      >
        {notesDraft !== null ? (
          <>
            <Field
              label={t.showSettings.notesTemplateEyebrow}
              value={notesDraft}
              onChangeText={setNotesDraft}
              multiline
              placeholder={t.showSettings.notesTemplatePlaceholder}
              help={t.showSettings.notesTemplateHelp}
            />
            <View style={st.sheetActions}>
              <Button
                label={t.common.save}
                accessibilityLabel={t.showSettings.a11ySaveNotesTemplate}
                onPress={() => void saveNotes()}
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
              onSelectionChange={(e) => {
                templateSel.current = e.nativeEvent.selection;
                if (forcedSel) setForcedSel(null);
              }}
              {...(forcedSel ? { selection: forcedSel } : {})}
              help={t.showSettings.templateHelp}
              multiline
            />
            <View style={st.helpWrap}>
              {PLACEHOLDER_KEYS.map((key) => {
                const desc = t.showSettings.placeholders[key];
                return (
                  <Chip
                    key={key}
                    icon="plus"
                    label={desc}
                    accessibilityLabel={t.showSettings.a11yInsertPlaceholder(desc)}
                    onPress={() => insertPlaceholder(key)}
                  />
                );
              })}
            </View>
            {templateDraft.trim() ? (
              <View style={st.preview}>
                <Text style={[typography.label, { color: c.textSecondary }]}>
                  {t.showSettings.templatePreview}
                </Text>
                <Text style={[typography.body, { color: c.textSecondary }]}>
                  {previewTemplate(templateDraft, placeholderNames)}
                </Text>
              </View>
            ) : null}
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

/**
 * 番組の紹介（見本 `.showhead .about`。Issue #259）。3 行に収まらなければ「もっと見る」で全文を開く。
 * 空なら「番組の紹介を書く」（見本 `.showhead .write`）で編集シートへ誘う。
 * 文が変わったら畳んだ状態に戻すため、呼び出し側で `key` に文を渡す。
 */
function ShowAbout({
  text,
  color,
  onWrite,
}: {
  text: string;
  /** 本文の色（著者の行と同じ、番組の色に重ねた 75% の白）。 */
  color: string;
  onWrite: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);

  if (!text) {
    return (
      <Pressable
        onPress={onWrite}
        accessibilityRole="button"
        hitSlop={hitSlop(typography.chipStrong.lineHeight)}
        style={({ pressed }) => [st.write, pressed ? { opacity: pressedOpacity } : null]}
      >
        <Icon name="edit" color={c.textPrimary} size={icon.inline} />
        <Text style={[typography.chipStrong, { color: c.textPrimary }]}>
          {t.showSettings.writeAbout}
        </Text>
      </Pressable>
    );
  }

  return (
    <View>
      {/* 3 行に収まるかを測るための見えない全文。読み上げには出さない */}
      <Text
        style={[typography.about, st.measure]}
        onTextLayout={(e) => setOverflow(e.nativeEvent.lines.length > ABOUT_LINES)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={!overflow}
        accessibilityLabel={text}
        {...(overflow
          ? {
              accessibilityRole: 'button' as const,
              accessibilityState: { expanded: open },
              accessibilityHint: open ? t.showSettings.aboutLess : t.showSettings.aboutMore,
            }
          : { accessibilityRole: 'text' as const })}
        style={({ pressed }) => [st.about, pressed ? { opacity: pressedOpacity } : null]}
      >
        <Text style={[typography.about, { color }]} numberOfLines={open ? 0 : ABOUT_LINES}>
          {text}
        </Text>
        {overflow ? (
          <Text style={[typography.aboutStrong, { color: c.textPrimary }]}>
            {open ? t.showSettings.aboutLess : t.showSettings.aboutMore}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * 番組画面の素材・ひな形の行（見本 `.field` の作法: 上に小さい名前、下に値、下端に線）。押すと編集を開く。
 */
function ListRow({
  heading,
  label,
  sub,
  icon: iconName,
  muted,
  onPress,
  accessibilityLabel,
}: {
  heading?: string;
  label: string;
  sub?: string;
  icon?: IconName;
  muted?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        st.listRow,
        { borderBottomColor: c.border },
        pressed ? { opacity: pressedOpacity } : null,
      ]}
    >
      {iconName ? <Icon name={iconName} color={c.textSecondary} size={icon.sm} /> : null}
      <View style={st.slotText}>
        {heading ? (
          <Text style={[typography.fieldLabel, { color: c.textSecondary }]}>{heading}</Text>
        ) : null}
        <Text
          style={[typography.rowTitle, { color: muted ? c.textSecondary : c.textPrimary }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sub ? <Text style={[typography.small, { color: c.textSecondary }]}>{sub}</Text> : null}
      </View>
      <Icon name="arrow" color={c.textTertiary} size={icon.sm} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  // 見本 `.showhead`: 左右 16、下 16、行の間 14。上はステータスバーの下から 10。
  head: { paddingBottom: space.lg, gap: space.x14 },
  headTop: { flexDirection: 'row', justifyContent: 'space-between' },
  cover: { alignItems: 'center' },
  name: { marginTop: space.x6 },
  by: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
  // 見本 `.showhead .about`: 本文と「もっと見る」の間 4。`.write`: 印と文字の間 8
  about: { gap: space.xs, alignItems: 'flex-start' },
  measure: { position: 'absolute', left: 0, right: 0, opacity: 0 },
  write: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' },
  // 見本 `.showhead .facts`: カテゴリーと Web サイト・言語の行の間 10、`.cats` / `.meta` の間 8、`.site` の印と文字の間 6
  facts: { gap: space.x10 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  site: { flexDirection: 'row', alignItems: 'center', gap: space.x6, flexShrink: 1 },
  grow: { flex: 1 },
  // 見本 `.eplist`: 左右 16、下 16。チップの下 4。
  body: { paddingBottom: space.lg },
  chips: { gap: space.sm, paddingBottom: space.xs },
  // 見本 `.epi`: 上下 14、行の間 6、下端に線。
  epi: { paddingVertical: space.x14, gap: space.x6, borderBottomWidth: stroke.hairline },
  epiText: { gap: space.x6 },
  epiDate: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dur: { marginRight: space.sm },
  subheading: { marginTop: space.xl, marginBottom: space.xs },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min,
    paddingVertical: space.x10,
    borderBottomWidth: stroke.hairline,
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.x10,
    borderBottomWidth: stroke.hairline,
    gap: space.sm,
  },
  slotText: { flex: 1, minWidth: 0, gap: space.hair },
  slotPick: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1 },
  layoutNote: { marginTop: space.sm },
  helpWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preview: { gap: space.xs, marginTop: space.md },
  sheetActions: { gap: space.sm, marginTop: space.md },
});
