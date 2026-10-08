"""README の画像（docs/readme/*.png）を見本から描き出す。

見本 docs/design-refresh/ds4/mock.html に上書きの CSS を足して、端末 5 台とロゴだけを並べ、
ヘッドレスの Google Chrome で撮る。見本を直したらこれを流し直す。

    python3 scripts/readme/generate.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOCK = ROOT / "docs/design-refresh/ds4/mock.html"
WORDMARK = ROOT / "assets/brand/wordmark-dark.svg"
ICON = ROOT / "assets/brand/app-icon.svg"
OUT = ROOT / "docs/readme"
CHROME = os.environ.get(
    "CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

# 見本のページ部品を隠し、端末を 1 列に並べる。端末の中身には触れない。
BASE_CSS = """
body { padding: 0 !important; overflow: hidden; }
.intro, .logo-sec, .derive, .notes, figcaption { display: none !important; }
"""

HERO_CSS = BASE_CSS + """
html, body { margin: 0 !important; background: radial-gradient(120% 90% at 50% 0%, #2a1a14 0%, #0a0a0a 62%) #0a0a0a !important; }
.readme-head { display: flex; align-items: center; justify-content: center; gap: 28px; padding: 64px 0 18px; }
.readme-head img.icon { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 0 0 1.5px #2a2a2a; }
.readme-head img.wm { height: 84px; }
.readme-tag { text-align: center; color: #b3b3b3; font: 600 24px/1.6 "Figtree", "Noto Sans JP", sans-serif; margin: 0 0 56px; }
.readme-tag b { color: #fff; font-weight: 800; }
.gallery { max-width: none !important; flex-wrap: nowrap !important; gap: 0 36px !important; align-items: flex-start; }
.gallery figure { width: 340px !important; flex: none; }
.gallery figure:nth-child(odd) { margin-top: 56px; }
"""

HERO_HTML = """
<div class="readme-head">
  <img class="icon" src="{icon}" alt="">
  <img class="wm" src="{wordmark}" alt="PodsNow.">
</div>
<p class="readme-tag"><b>録って、切って、書き出す。</b>ポッドキャストをスマホひとつで。</p>
"""


def build(css: str, prefix: str, tmp: Path) -> Path:
    html = MOCK.read_text(encoding="utf-8")
    html = html.replace("</style>", css + "\n</style>", 1)
    head = prefix.format(icon=ICON.as_uri(), wordmark=WORDMARK.as_uri())
    html = html.replace('<main class="gallery">', head + '<main class="gallery">', 1)
    page = tmp / "page.html"
    page.write_text(html, encoding="utf-8")
    return page


def shoot(page: Path, out: Path, width: int, height: int, tmp: Path) -> None:
    # 撮り終えても Chrome が終わらないことがあるので、画像ができたら止める。
    out.unlink(missing_ok=True)
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--allow-file-access-from-files",
            f"--user-data-dir={tmp / 'chrome'}",
            f"--window-size={width},{height}",
            "--force-device-scale-factor=2",
            "--virtual-time-budget=8000",
            f"--screenshot={out}",
            page.as_uri(),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(180):
            if proc.poll() is not None:
                break
            if out.exists() and out.stat().st_size > 0:
                time.sleep(1)
                break
            time.sleep(1)
    finally:
        proc.kill()
        proc.wait()
    if not out.exists():
        raise RuntimeError(f"撮れなかった: {out}")


def main() -> int:
    if not Path(CHROME).exists():
        print(f"Google Chrome が見つからない: {CHROME}（環境変数 CHROME で指定）", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        page = build(HERO_CSS, HERO_HTML, tmp)
        shoot(page, OUT / "hero.png", 1960, 1180, tmp)
    print(f"wrote {OUT / 'hero.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
