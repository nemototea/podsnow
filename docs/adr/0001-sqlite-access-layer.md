# ADR 0001: SQLite アクセス層は素の SQL + 薄い Executor 抽象にする（Drizzle は採用しない）

- 状態: 採用（2026-09-19）
- 関連: Issue #5、ARCHITECTURE.md §1 A-1、DATA_MODEL.md §8

## 背景

expo-sqlite には Drizzle ORM の公式統合がある【確認済み】(https://docs.expo.dev/versions/latest/sdk/sqlite/)。
型付きクエリと drizzle-kit による移行生成が得られる一方、依存が増え、移行 SQL の検証を Jest（Node）で行うには別の経路が必要になる。

## 決定

1. スキーマは **手書きの DDL**（`src/infra/db/migrations/NNNN_*.ts`）で管理し、`PRAGMA user_version` で前進させる。
2. DB 実装は `SqlExecutor` インターフェース（`exec / run / all / get / transaction`）に閉じ込め、
   アプリでは expo-sqlite、Jest では Node 組み込みの `node:sqlite` で同じ DDL とクエリを実行する。
3. テーブルごとの repository（`src/infra/db/repositories/`）は SQL を文字列で持ち、行型は TypeScript で手書きする。
4. Drizzle はクエリの量が増えて手書きが負担になった時点で再検討する（executor 抽象の背後に入れられる）。

## 理由

- 移行 SQL を Node で実行してテストできる（`node:sqlite` はネイティブビルド不要。CI の Node 22+ で利用可）。
- MVP のクエリは単純（主キー検索・エピソード単位の一覧）で ORM の恩恵が小さい。
- `data-safety` 領域（復旧、`voice_segments` の編集）は SQL を直接読める方がレビューしやすい。

## 影響

- 行型と SQL の不一致はテストで捕まえる（repository ごとに node:sqlite でのテストを書く）。
- 破壊的なスキーマ変更は「新列追加 → 移送 → 旧列放置」の手順（DATA_MODEL.md §8）。

## 未検証

- Jest の `node:sqlite` と expo-sqlite が同梱する SQLite のバージョン差による DDL 差異は理論上あり得る。DDL は標準的な構文（CHECK / FK / INDEX）に限定する。
