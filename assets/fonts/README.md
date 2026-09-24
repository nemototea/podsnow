# 同梱書体（Issue #94）

| ファイル | 書体 | 太さ | 出典 | ライセンス |
|---|---|---|---|---|
| `Manrope-{Regular,Medium,SemiBold,Bold}.ttf` | Manrope | 400 / 500 / 600 / 700 | https://github.com/google/fonts/tree/main/ofl/manrope | SIL OFL 1.1（`Manrope-OFL.txt`） |
| `NotoSansJP-{Regular,Medium,SemiBold,Bold}.ttf` | Noto Sans JP | 400 / 500 / 600 / 700 | https://github.com/google/fonts/tree/main/ofl/notosansjp | SIL OFL 1.1（`NotoSansJP-OFL.txt`） |

【事実】Manrope と Noto Sans JP は Google Fonts の可変フォント（`[wght]`）から、使う太さだけを静的な
インスタンスとして切り出した（`scripts/fonts/generate.py`、fontTools の `instantiateVariableFont`）。
字形は変更していない。#110 で IBM Plex Mono の同梱を廃止し、数字は Manrope の tabular figures を使用する。原本の SHA-256 は `generate.py` に
記録してあり、2026-09-22 に設計の受け渡しパッケージに含まれていた原本と一致した。

【事実】OFL は、書体をソフトウェアに同梱して配布することを認めている。書体単体で販売しないこと、
ライセンス文を添えることが条件。切り出したインスタンスは OFL の「Modified Version」に当たり、
予約フォント名（Reserved Font Name）を名乗れない。各 OFL.txt の冒頭で、Noto Sans JP は `Source` が予約されている。
切り出した Noto Sans JP は `Noto Sans JP` の名前のままで `Source`
を含まない。Manrope に予約フォント名は無い。
【仮説】この解釈は OFL 1.1 の条文（第 3 条）に基づく。法的な確認はしていない。

ロゴ `PodsNow.` の輪郭は Manrope 800 から作っている（`scripts/brand/glyphs.py`）。800 の書体ファイルは同梱しない。

再生成:

```sh
python3 -m pip install fonttools
python3 scripts/fonts/generate.py            # 原本を google/fonts から取得してハッシュを照合
python3 scripts/fonts/generate.py --source-dir <原本のあるディレクトリ>
```
