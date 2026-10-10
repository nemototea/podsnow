import { primaryCategory, setPrimaryCategory } from '@/domain/podcast/categories';
import type { PodcastCategory } from '@/domain/podcast/feed';
import type { ShowInfo, ShowInfoPatch } from '@/services/shows/ShowService';

/** 番組情報の編集シートの入力中の値（Issue #167、#259）。 */
export interface ShowInfoDraft {
  name: string;
  description: string;
  author: string;
  websiteUrl: string;
  /** `shows.language` の値そのもの（`en-us` のような地域つきも、選び直すまでそのまま持つ）。 */
  language: string;
  explicit: boolean;
  /** 主カテゴリー。副のカテゴリー（取り込んだ 2 つ目以降）はシートでは触らない。 */
  primary: PodcastCategory;
}

export function draftFromInfo(info: ShowInfo): ShowInfoDraft {
  return {
    name: info.show.name,
    description: info.show.description,
    author: info.show.author,
    websiteUrl: info.show.website_url,
    language: info.show.language,
    explicit: info.show.explicit === 1,
    primary: primaryCategory(info.categories),
  };
}

/** 今の番組情報をそのまま書き戻す値（保存の取り消しに使う）。 */
export function patchFromInfo(info: ShowInfo): ShowInfoPatch {
  const d = draftFromInfo(info);
  return {
    name: d.name,
    description: d.description,
    author: d.author,
    websiteUrl: d.websiteUrl,
    language: d.language,
    explicit: d.explicit,
    categories: info.categories,
  };
}

/**
 * シートを閉じたときに書く値。何も変わっていなければ null（保存も通知もしない）。
 * 番組名が空なら `fallbackName`（番組名の既定）にする。カテゴリーは主が変わったときだけ置き換える。
 */
export function patchFromDraft(
  draft: ShowInfoDraft,
  before: ShowInfo,
  fallbackName: string,
): ShowInfoPatch | null {
  const prev = patchFromInfo(before);
  const was = primaryCategory(before.categories);
  const primaryChanged =
    draft.primary.category !== was.category || draft.primary.subcategory !== was.subcategory;
  const next: ShowInfoPatch = {
    name: draft.name.trim() || fallbackName,
    description: draft.description,
    author: draft.author,
    websiteUrl: draft.websiteUrl.trim(),
    language: draft.language.trim().toLowerCase(),
    explicit: draft.explicit,
    categories: primaryChanged
      ? setPrimaryCategory(before.categories, draft.primary)
      : before.categories,
  };
  const same =
    !primaryChanged &&
    next.name === prev.name &&
    next.description === prev.description &&
    next.author === prev.author &&
    next.websiteUrl === prev.websiteUrl &&
    next.language === prev.language &&
    next.explicit === prev.explicit;
  return same ? null : next;
}
