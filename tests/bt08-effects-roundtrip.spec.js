// bt08: 書き出したpptxをアプリ自身に再インポートし、
//   ・テーマ色図形（塗り未指定の楕円）が出力ファイルに実在すること
//   ・画面切り替えが再構築スライドに引き継がれていること
// を「出力ファイルそのもの」に対して検証する（申告ではなく実物での確認）。
const { test, expect } = require('@playwright/test');
const path = require('path');
const os = require('os');

test('書き出したpptxを再インポートすると、テーマ色図形が実在する', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'shapes.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  // 一時ファイルには拡張子が付かないため、.pptx名を付けて保存してから再インポートする
  const outPath = path.join(os.tmpdir(), `bt08-shapes-${Date.now()}.pptx`);
  await download.saveAs(outPath);

  // 出力ファイルをそのまま再インポート
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', outPath);
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const elements = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup'); // バージョン省略＝アプリが作成した既存DBをそのまま開く
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['projects', 'slides'], 'readonly');
    const projects = await new Promise((res, rej) => { const r = tx.objectStore('projects').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    // 最後に追加されたプロジェクト（=再インポート分）のスライドを見る
    const latest = projects.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    return all.filter((s) => s.projectId === latest.id)[0].elements;
  });

  // 元の4図形（+テキストオーバーレイ）が出力に残っている
  const shapes = elements.filter((e) => e.type === 'shape' && !e.isTextBox);
  expect(shapes.length).toBeGreaterThanOrEqual(4);
  const themed = shapes.find((e) => e.shapeType === 'ellipse');
  expect(themed).toBeTruthy();
  expect(themed.fill.color).toBe('#4F81BD'); // テーマ色が実色として焼き込まれている
});

test('書き出したpptxを再インポートすると、画面切り替えが引き継がれている', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'anim.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  const outPath = path.join(os.tmpdir(), `bt08-anim-${Date.now()}.pptx`);
  await download.saveAs(outPath);

  await page.goto('/index.html');
  await page.setInputFiles('#file-input', outPath);
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const slides = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup'); // バージョン省略＝アプリが作成した既存DBをそのまま開く
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['projects', 'slides'], 'readonly');
    const projects = await new Promise((res, rej) => { const r = tx.objectStore('projects').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const latest = projects.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const mine = all.filter((s) => s.projectId === latest.id);
    mine.sort((a, b) => a.index - b.index);
    return mine.map((s) => ({ hasAnimation: s.hasAnimation, hasTransition: s.hasTransition }));
  });

  expect(slides[0].hasAnimation).toBe(true);  // 温存スライド: アニメーションが実在
  expect(slides[1].hasTransition).toBe(true); // 再構築スライド: 画面切り替えが引き継がれている
});
