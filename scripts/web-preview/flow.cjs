// 画面検証用の撮影（docs/design-refresh/README.md §6）。Design system 4（#235）の見本と並べて見る順に撮る。
//   OUT=<撮影先> NODE_PATH=$(npm root -g) node scripts/web-preview/flow.cjs
// 番組の代表色は ?showColor= で与える（shims/expo-sqlite.js。画像は読めないので名前の表紙になる）。
const { chromium } = require('playwright');
const OUT = process.env.OUT || '.';
const W = +(process.env.W || 390), H = +(process.env.H || 844);
const LOCALE = process.env.LOC || 'ja-JP';
const TAG = process.env.TAG || `${LOCALE.slice(0, 2)}-${W}`;
const SHOW = process.env.SHOW || '%23C4492F';
const NAME = encodeURIComponent(process.env.SHOW_NAME || '夜更けのラジオ');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: LOCALE, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('dialog', (d) => { console.log('dialog: ' + d.message().replace(/\n/g, ' / ')); void d.accept(); });
  const shot = async (name) => { await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${TAG}-${name}.png` }); console.log('shot', name); };
  const label = (l) => p.getByLabel(l, { exact: true }).first();
  const text = (s) => p.getByText(s, { exact: true }).first();
  const ja = LOCALE.startsWith('ja');
  const T = (j, e) => (ja ? j : e);
  await p.goto(`http://localhost:8765/?speed=60&showColor=${SHOW}&showName=${NAME}&showAuthor=nemoto`);
  await p.waitForTimeout(2500);
  await shot('01-home-empty');
  await text(T('新しく始める', 'Start a new show')).click(); await p.waitForTimeout(1500);
  await shot('01b-show-new');
  await label(T('戻る', 'Back')).click(); await p.waitForTimeout(1200);

  // 1 本目: 録って、編集して、書き出す
  await label(T('新しいエピソードを録る', 'Record a new episode')).click(); await p.waitForTimeout(1500);
  await shot('02-episode-idle');
  await text(T('録音を開始', 'Start recording')).click(); await p.waitForTimeout(3000);
  await shot('03-recording');
  await label(T('一時停止', 'Pause')).click(); await shot('04-paused');
  await label(T('再開', 'Resume')).click(); await p.waitForTimeout(2000);
  await label(T('録音を止める', 'Stop recording')).click(); await p.waitForTimeout(2000);
  await shot('05-edit');
  const box = await p.locator('[data-testid="timeline"]').first().boundingBox().catch(() => null);
  if (box) { await p.mouse.click(box.x + 80, box.y + 60); await p.waitForTimeout(900); }
  await shot('06-edit-selection');
  await text(T('削除', 'Delete')).click(); await p.waitForTimeout(900);
  await shot('07-deleted-toast');
  await text(T('取り消す', 'Undo')).click(); await p.waitForTimeout(900);
  await text(T('書き出し', 'Export')).click(); await p.waitForTimeout(1500);
  await shot('08-export');
  await text(T('書き出して共有', 'Export and share')).click(); await p.waitForTimeout(4500);
  await shot('09-share');
  await p.goBack(); await p.waitForTimeout(800); await p.goBack(); await p.waitForTimeout(1500);

  // 2 本目: 録って下書きのまま戻る（下書きバー）
  await label(T('新しいエピソードを録る', 'Record a new episode')).click(); await p.waitForTimeout(1500);
  await text(T('録音を開始', 'Start recording')).click(); await p.waitForTimeout(2500);
  await label(T('録音を止める', 'Stop recording')).click(); await p.waitForTimeout(1500);
  await label(T('戻る', 'Back')).click(); await p.waitForTimeout(1800);
  await shot('10-home');
  await p.mouse.wheel(0, 900); await shot('11-home-bottom');
  await p.mouse.wheel(0, -900);
  await label(T('夜更けのラジオ を開く', 'Open 夜更けのラジオ')).click(); await p.waitForTimeout(1500);
  await shot('12-show');
  await text(T('素材', 'Sounds')).click(); await shot('13-show-assets');
  await text(T('ひな形', 'Templates')).click(); await shot('14-show-templates');
  await label(T('戻る', 'Back')).click(); await p.waitForTimeout(1200);
  await label(T('設定', 'Settings')).click(); await p.waitForTimeout(1200);
  await shot('15-settings');
  console.log('ERRORS:\n' + errors.join('\n'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
