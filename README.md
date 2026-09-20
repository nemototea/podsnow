# PodsNow

スマートフォンだけでポッドキャストの収録 → 編集 → 書き出し → 配信準備を完結させる、ローカルファーストの収録アプリ。
Expo SDK 57 / React Native / TypeScript。iOS / Android。日本語 / 英語対応。

> 表記は **PodsNow（ポッズナウ）**。リポジトリ名・`slug`・bundle id・バックアップ拡張子 `.podsnow` などの識別子は小文字の `podsnow`。

- 何を作るか: [PRODUCT.md](PRODUCT.md)
- 要件: [REQUIREMENTS.md](REQUIREMENTS.md)
- 設計: [ARCHITECTURE.md](ARCHITECTURE.md) / [DATA_MODEL.md](DATA_MODEL.md) / [AUDIO_DESIGN.md](AUDIO_DESIGN.md)
- 開発: [DEVELOPMENT.md](DEVELOPMENT.md)

## セットアップ

```sh
npm install
npm run ios      # または npm run android（Development Build）
npm run lint && npm run typecheck && npm test
```
