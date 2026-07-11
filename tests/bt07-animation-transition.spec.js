// bt07: anim.pptx（slide1=アニメーションあり / slide2=画面切り替えのみ / slide3=効果なし）で
// アニメーション・画面切り替えの検出と取り扱いを検証する。
//   ・アニメーションを含むスライドは初期設定で「温存」（元のまま保持＝アニメも残る）
//   ・温存はチェックボックスで解除可能（解除して再構築するとアニメは失われ、警告が出る）
//   ・画面切り替えは、再構築されたスライドにも引き継がれる
const { test, expect } = require('@playwright/test');
const path = require('path');

async function importAnim(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'anim.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });
}

async function getSlides(page) {
  return page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup', 1);
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readonly');
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    all.sort((a, b) => a.index - b.index);
    return all.map((s) => ({ hasAnimation: s.hasAnimation, hasTransition: s.hasTransition, preserve: s.preserve, transitionXml: s.transitionXml }));
  });
}

test('アニメーション/画面切り替えが検出され、アニメ含有スライドは初期設定で温存される', async ({ page }) => {
  await importAnim(page);
  const slides = await getSlides(page);

  expect(slides[0].hasAnimation).toBe(true);
  expect(slides[0].preserve).toBe(true); // アニメ→初期値で温存

  expect(slides[1].hasTransition).toBe(true);
  expect(slides[1].transitionXml).toContain('p:fade');
  expect(slides[1].preserve).toBe(false); // 切り替えのみは温存不要（引き継げるため）

  expect(slides[2].hasAnimation).toBe(false);
  expect(slides[2].hasTransition).toBe(false);

  await expect(page.locator('#stat-preserve-count')).toHaveText('1');
  await expect(page.locator('#slide-grid .slide-card').nth(0).locator('.slide-card__stats')).toContainText('アニメーションあり');
});

test('温存のまま書き出すと検証OK、温存解除で再構築するとアニメ喪失の警告が出て検証もOK', async ({ page }) => {
  await importAnim(page);

  // 温存あり書き出し
  let [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  await page.waitForSelector('#build-result:not([hidden])');
  expect(await page.locator('#build-result .verify-badge.ng').count()).toBe(0);
  await download.path();

  // 温存トグルを解除して全再構築
  const toggle = page.locator('#slide-grid .slide-card').nth(0).locator('.preserve-toggle');
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled(); // ハード理由（グラフ等）ではないため解除可能
  await toggle.uncheck();
  await expect(page.locator('#stat-preserve-count')).toHaveText('0');

  [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  await page.waitForSelector('#build-result:not([hidden])');
  expect(await page.locator('#build-result .verify-badge.ng').count()).toBe(0);
  await expect(page.locator('#build-result')).toContainText('アニメーションは失われました');
  await download.path();
});

test('グラフ含有スライドの温存トグルは解除不可（ハード理由）', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'preserve.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const chartToggle = page.locator('#slide-grid .slide-card').nth(0).locator('.preserve-toggle');
  await expect(chartToggle).toBeChecked();
  await expect(chartToggle).toBeDisabled();
});
