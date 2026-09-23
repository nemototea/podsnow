#!/usr/bin/env bash
# 画面検証用の Web ビルド（docs/design-refresh/README.md §6）。製品には含めない。
#
#   npm install --no-save --legacy-peer-deps react-native-web@~0.21.0 @expo/metro-runtime@~57.0.16 sql.js@1.13.0
#   bash scripts/web-preview/build.sh            # → $OUT_DIR/dist を http://localhost:8765 で配信
#   OUT=<撮影先> NODE_PATH=$(npm root -g) node scripts/web-preview/flow.cjs     # Playwright で操作・撮影
#
# SQLite は sql.js、ファイルはメモリ、録音と音声エンジンはシミュレータに差し替える。
# ネイティブの録音・再生・書き出しの動作確認にはならない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/web-preview"
OUT_DIR="${OUT_DIR:-${TMPDIR:-/tmp}/podsnow-web-preview}"
rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR"
cd "$ROOT"
tar --exclude=./node_modules --exclude=./.git --exclude=./scripts/web-preview -cf - . | (cd "$OUT_DIR" && tar xf -)
ln -s "$ROOT/node_modules" "$OUT_DIR/node_modules"
cp -r "$HERE/shims" "$OUT_DIR/shims"
cp "$HERE/metro.config.js" "$OUT_DIR/metro.config.js"
cp "$HERE/sim/recorderAdapter.ts.txt" "$OUT_DIR/src/infra/native/recorderAdapter.ts"
cp "$HERE/sim/audioEngineAdapter.ts.txt" "$OUT_DIR/src/infra/native/audioEngineAdapter.ts"
sed -i 's/seekAt(e.nativeEvent.locationX)/seekAt((e.nativeEvent as any).pageX - (e.currentTarget as any).getBoundingClientRect().left)/' \
  "$OUT_DIR/src/features/episode/Waveform.tsx"
cd "$OUT_DIR"
PODSNOW_ROOT="$ROOT" CI=1 npx expo export -p web --output-dir dist
cp "$ROOT/node_modules/sql.js/dist/sql-wasm.wasm" dist/
mkdir -p dist/fonts && cp "$ROOT"/assets/fonts/*.ttf dist/fonts/
python3 - <<'PY'
names = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold'}
fams = [('Manrope', 'Manrope', [400, 500, 600, 700]), ('Noto Sans JP', 'NotoSansJP', [400, 500, 600, 700]), ('IBM Plex Mono', 'IBMPlexMono', [400])]
faces = ''.join(
    f"@font-face{{font-family:'{f}';src:url('/fonts/{p}-{names[w]}.ttf') format('truetype');font-weight:{w};font-display:block}}"
    for f, p, ws in fams for w in ws
)
s = open('dist/index.html').read().replace('</head>', f'<style>{faces}</style></head>')
open('dist/index.html', 'w').write(s)
PY
echo "built: $OUT_DIR/dist  (serve: cd $OUT_DIR/dist && python3 -m http.server 8765)"
