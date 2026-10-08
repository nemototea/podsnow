const { chromium } = require('playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const run = async (name, q, fn) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP', colorScheme: 'dark' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    // 確認・エラー・権限は OS のアラート（Web では confirm / alert）。内容を記録して閉じる。
    p.on('dialog', (d) => { console.log(`dialog[${name}]: ${d.message().replace(/\n/g, ' / ')}`); void d.dismiss(); });
    await p.goto(`http://localhost:8765/?speed=60${q}`); await p.waitForTimeout(2500);
    const shot = async (n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/state-${n}.png` }); console.log('shot', n); };
    await fn(p, shot);
    await ctx.close();
  };
  const newEp = async (p) => { await p.getByText('新しいエピソードを録る').click(); await p.waitForTimeout(1500); };
  const lab = (p, l) => p.getByLabel(l, { exact: true }).first();
  await run('perm', '&perm=undetermined', async (p, shot) => { await newEp(p); await lab(p, '録音を開始').click(); await shot('mic-permission'); });
  await run('denied', '&perm=denied', async (p, shot) => { await newEp(p); await lab(p, '録音を開始').click(); await shot('mic-denied-android-requests-or-ios-settings'); });
  await run('bt', '&bt=1', async (p, shot) => { await newEp(p); await lab(p, '録音を開始').click(); await p.waitForTimeout(1500); await shot('bluetooth-warning'); });
  await run('interrupt', '', async (p, shot) => {
    await newEp(p); await lab(p, '録音を開始').click(); await p.waitForTimeout(1500);
    await p.evaluate(() => globalThis.__sim.interrupt()); await p.waitForTimeout(800);
    await shot('interrupted');
    await p.getByRole('tab', { name: '編集' }).click(); await shot('tab-blocked-while-live');
  });
  await run('exportfail', '&exportFail=1', async (p, shot) => {
    await newEp(p); await lab(p, '録音を開始').click(); await p.waitForTimeout(1500);
    await lab(p, '収録を終える').click(); await p.waitForTimeout(1500);
    await p.getByRole('tab', { name: '書き出し' }).click(); await p.waitForTimeout(1000);
    await p.getByText('音声を書き出す').click(); await p.waitForTimeout(3500);
    await p.mouse.wheel(0, 2400); await shot('export-failed');
  });
  await run('notes', '', async (p, shot) => {
    await newEp(p);
    await lab(p, 'カンペを書く').click(); await p.waitForTimeout(600);
    await p.getByLabel('カンペ', { exact: true }).last().fill('オープニング\n・最近の朝のルーティン\n・習慣をひとつ、手放してみる\n・明日から試してみたいこと\nエンディング');
    await shot('notes-sheet');
    await lab(p, '完了してカンペを保存').click(); await p.waitForTimeout(600);
    await lab(p, '録音を開始').click(); await p.waitForTimeout(1200);
    await shot('notes-recording');
  });
  await run('menu', '', async (p, shot) => {
    await newEp(p); await lab(p, '録音を開始').click(); await p.waitForTimeout(1200); await lab(p, '収録を終える').click(); await p.waitForTimeout(1200);
    await p.locator('[aria-label$="back"]').first().click(); await p.waitForTimeout(1200);
    await shot('home-episode-list');
    await p.getByText('新しいエピソードを録る').click(); await p.waitForTimeout(1200); await p.locator('[aria-label$="back"]').first().click(); await p.waitForTimeout(1200);
    await p.getByLabel(/の操作$/).first().click(); await shot('episode-menu-sheet');
  });
  console.log('ERRORS:\n' + errors.join('\n'));
  await b.close();
})();
