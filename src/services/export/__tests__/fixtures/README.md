# 書き出しのテスト用 fixture

| ファイル | 中身 |
| --- | --- |
| `cover.jpg` | カバー画像を埋め込むテスト用の小さな JPEG |
| `moov-last.m4a` | 0.5 秒・440 Hz の AAC。`moov` が `mdat` の後ろにある（ffmpeg の既定） |
| `moov-first.m4a` | 中身は同じで、`moov` が前にある（`+faststart`） |

`.m4a` は `.gitignore` で除外されるため、このディレクトリだけ例外にしている（#227）。

## 作り直し方

ffmpeg 8.0.1 で作った（#56 のときは 6.1）。どちらも Lavf が `ilst`（encoder タグ）を書く。テストは、それが置き換わることを確かめている。

```sh
cd src/services/export/__tests__/fixtures
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.5" -c:a aac -b:a 64k moov-last.m4a
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.5" -c:a aac -b:a 64k -movflags +faststart moov-first.m4a
```
