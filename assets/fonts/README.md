# 同梱書体（Issue #94 / #190 / #235）

| ファイル | 書体 | 太さ | 出典 | ライセンス |
|---|---|---|---|---|
| `Figtree-{Regular,Medium,SemiBold,Bold,ExtraBold,Black}.ttf` | Figtree | 400 / 500 / 600 / 700 / 800 / 900 | https://github.com/google/fonts/tree/main/ofl/figtree | SIL OFL 1.1（`Figtree-OFL.txt`） |
| `NotoSansJP-{Regular,Medium,SemiBold,Bold}.ttf` | Noto Sans JP | 400 / 500 / 600 / 700 | https://github.com/google/fonts/tree/main/ofl/notosansjp | SIL OFL 1.1（`NotoSansJP-OFL.txt`） |

【事実】Figtree と Noto Sans JP は Google Fonts の可変フォント（`[wght]`）から、使う太さだけを静的な
インスタンスとして切り出した（`scripts/fonts/generate.py`、fontTools の `instantiateVariableFont`）。
字形は変更していない。原本の SHA-256 は `generate.py` に記録してある（Figtree は 2026-10-06 に google/fonts の main から取得）。

【事実】#235 で Manrope（欧文 UI と数字）と Dela Gothic One（番組名・看板の語・ロゴ）をやめ、Figtree に替えた。
Figtree は等幅数字（`tnum`）を持ち、0 は中が空いた形（`scripts/fonts/verify.py` が全ウェイトで検査する）。
6 ウェイトの合計は 240,616 バイトで、Manrope 4 ウェイト（389,980 バイト）と Dela Gothic One（2,508,848 バイト）より小さい。

【事実】OFL は、書体をソフトウェアに同梱して配布することを認めている。書体単体で販売しないこと、
ライセンス文を添えることが条件。切り出したインスタンスは OFL の「Modified Version」に当たり、
予約フォント名（Reserved Font Name）を名乗れない。各 OFL.txt の冒頭で、Noto Sans JP は `Source` が予約されている。
切り出した Noto Sans JP は `Noto Sans JP` の名前のままで `Source`
を含まない。Figtree の OFL.txt に予約フォント名の指定は無い。
【仮説】この解釈は OFL 1.1 の条文（第 3 条）に基づく。法的な確認はしていない。

ロゴ `PodsNow.` の輪郭は #235 から Figtree 900 から作る（`scripts/brand/glyphs.py`）。

【仮説】Figtree の 500 / 600 / 800 / 900 は、Noto Sans JP の 500 / 600 と同じく名前 ID 1 が「Figtree Black」のような
太さ付きの名前で、名前 ID 16 が「Figtree」。iOS と Android で `fontFamily: 'Figtree'` と `fontWeight` の組で選べるかは実機で確かめる（DS-1）。

再生成:

```sh
python3 -m pip install fonttools
python3 scripts/fonts/generate.py                 # 原本を google/fonts から取得してハッシュを照合
python3 scripts/fonts/generate.py --only Figtree  # 1 書体だけ書き出す
python3 scripts/fonts/generate.py --source-dir <原本のあるディレクトリ>
python3 scripts/fonts/verify.py                   # 等幅数字と 0 の形を検査
```
