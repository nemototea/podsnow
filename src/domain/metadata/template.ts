/**
 * 概要欄ベーステンプレートの展開（DATA_MODEL.md §4.3、FR-META-2/3）。
 * 変数は {{title}} {{episode_number}} {{season}} {{topics}} {{show_name}} のみ。未知の変数はそのまま残す。
 */
export interface TemplateVars {
  title: string;
  episodeNumber: number;
  season: number;
  topics: readonly string[];
  showName: string;
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  const topics = vars.topics
    .filter((t) => t.trim())
    .map((t) => `・${t.trim()}`)
    .join('\n');
  const map: Record<string, string> = {
    title: vars.title,
    episode_number: String(vars.episodeNumber),
    season: String(vars.season),
    topics,
    show_name: vars.showName,
  };
  const pattern = /\{\{\s*(\w+)\s*\}\}/g;
  const expand = (line: string) =>
    line.replace(pattern, (m, k: string) => (k in map ? map[k]! : m));
  const hasKnownVar = (line: string) =>
    [...line.matchAll(pattern)].some((m) => (m[1] ?? '') in map);

  // 変数が空になって中身が無くなった行だけを消す（Issue #167）。
  // ユーザーがテンプレートに入れた空行は、何行続いていてもそのまま残す。
  const src = body.split('\n');
  const out: string[] = [];
  const isBlank = (line: string | undefined) => line !== undefined && line.trim() === '';
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const expanded = expand(line);
    if (hasKnownVar(line) && expanded.trim() === '') {
      // 消した行の上下がどちらも空行なら、下の空行も消して跡を残さない
      if (isBlank(out[out.length - 1]) && isBlank(src[i + 1])) i++;
      continue;
    }
    out.push(expanded);
  }
  // 先頭・末尾の空行は詰める
  while (isBlank(out[0])) out.shift();
  while (isBlank(out[out.length - 1])) out.pop();
  return out.join('\n');
}

/** 概要のうち、トークテーマ由来の箇条書き部分を差し替える（既存の「・」行ブロックを置換、無ければ末尾に追加）。 */
export function insertTopics(description: string, topics: readonly string[]): string {
  const block = topics
    .filter((t) => t.trim())
    .map((t) => `・${t.trim()}`)
    .join('\n');
  const lines = description.split('\n');
  const first = lines.findIndex((l) => l.startsWith('・'));
  if (first === -1) return description.trim() ? `${description.trimEnd()}\n\n${block}` : block;
  let last = first;
  while (last + 1 < lines.length && lines[last + 1]!.startsWith('・')) last++;
  return [...lines.slice(0, first), block, ...lines.slice(last + 1)].join('\n');
}

/** 「全メタデータ」テキストの見出し。表示言語は UI 層が決める（Issue #80）。 */
export interface MetadataLabels {
  title: string;
  episode: string;
  season: string;
  recordedAt: string;
  duration: string;
  file: string;
}

/**
 * Distribution Pack 用の「全メタデータ」テキスト。
 * domain は文言を持たないので、見出しは `labels` で受け取る（ARCHITECTURE.md §2）。
 */
export function formatAllMetadata(m: {
  title: string;
  episodeNumber: number;
  season: number;
  recordedAt: Date | null;
  durationLabel: string;
  fileName: string;
  description: string;
  labels: MetadataLabels;
}): string {
  const date = m.recordedAt ? m.recordedAt.toISOString().slice(0, 10) : '';
  const lab = m.labels;
  return [
    `${lab.title}: ${m.title}`,
    `${lab.episode}: #${m.episodeNumber}`,
    `${lab.season}: ${m.season}`,
    date ? `${lab.recordedAt}: ${date}` : null,
    `${lab.duration}: ${m.durationLabel}`,
    `${lab.file}: ${m.fileName}`,
    '',
    m.description,
  ]
    .filter((line) => line !== null)
    .join('\n');
}
