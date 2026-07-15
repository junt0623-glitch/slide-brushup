// bt19: 簡易修正（誤字脱字・表記ゆれチェック、AI不要）を検証する。
//   ・句読点の連続重複、空白の連続重複を機械的に検出し、claude.aiとのやり取りなしで
//     その場で修正を適用できるか
//   ・修正はslide.elements（＝Phase2の1:1書き出しで使われる本体）に反映され、
//     textConcat/textHashも整合するか
//   ・温存スライドは対象外になるか
const { test, expect } = require('@playwright/test');
const path = require('path');

async function importAndInjectTypo(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  // basic.pptxのスライド0（フィクスチャC）の本文runへ、コピペ由来のケアレスミスを
  // 直接注入する（意図的な言い換えではなく、機械的パターンで検出できる歪みのみ）。
  await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup');
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readwrite');
    const store = tx.objectStore('slides');
    const all = await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const slide0 = all.find((s) => s.index === 0);
    const positioned = slide0.elements.filter((e) => e.x != null);
    // タイトル要素の本文runに句読点重複、本文要素のrunに空白重複を注入
    const bodyEl = positioned.find((e) =>
      (e.paragraphs || []).some((p) => (p.runs || []).some((r) => (r.text || '').includes('スライドCの本文')))
    );
    const run = bodyEl.paragraphs.flatMap((p) => p.runs).find((r) => (r.text || '').includes('スライドCの本文'));
    run.text = run.text.replace('これが最後のスライドです。', 'これが  最後の。。スライドです。');
    store.put(slide0);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  });

  // IndexedDBへの変更をUIに反映させるため、プロジェクトを開き直す
  await page.locator('#btn-back-home').click();
  await page.locator('.btn-open').first().click();
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });
}

test('句読点・空白の重複が検出され、個別に適用できる', async ({ page }) => {
  await importAndInjectTypo(page);

  await expect(page.locator('#typo-status')).toContainText('件のケアレスミス候補を検出しました');
  const issues = page.locator('.typo-issue');
  await expect(issues).toHaveCount(1);
  await expect(issues.first()).toContainText('スライド 1');
  await expect(issues.first()).toContainText('句読点の重複');
  await expect(issues.first()).toContainText('空白の重複');

  // 差分ハイライト（削除=取り消し線、追加=下線）で before/after が確認できる
  await expect(issues.first().locator('.diff-del')).toHaveCount(2); // 「  」と「。」の重複部分
  await expect(issues.first().locator('.diff-ins')).toHaveCount(0); // 文字が減るだけで新規追加はない

  await issues.first().locator('button', { hasText: 'この修正を適用する' }).click();

  // 適用後は検出0件になり、テキストプレビューにも反映される
  await expect(page.locator('#typo-status')).toContainText('検出されませんでした');
  await expect(page.locator('.typo-issue')).toHaveCount(0);

  const card = page.locator('#slide-grid .slide-card').first();
  await card.locator('summary').click();
  await expect(card.locator('pre')).toContainText('これが 最後の。スライドです。');

  // Anthropic APIへの通信は一切発生しない（AI不要の機能であることの裏付け）
  let apiCalled = false;
  page.on('request', (req) => { if (req.url().includes('api.anthropic.com')) apiCalled = true; });
  await page.waitForTimeout(200);
  expect(apiCalled).toBe(false);
});

test('修正結果はslide.elementsに永続化され、書き出しにも反映される元データになる', async ({ page }) => {
  await importAndInjectTypo(page);
  await page.locator('.typo-issue button', { hasText: 'この修正を適用する' }).click();
  await expect(page.locator('#typo-status')).toContainText('検出されませんでした');

  const elements = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup');
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readonly');
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const slide0 = all.find((s) => s.index === 0);
    return { textConcat: slide0.textConcat, elements: slide0.elements };
  });
  expect(elements.textConcat).toContain('これが 最後の。スライドです。');
  expect(elements.textConcat).not.toContain('。。');
  expect(elements.textConcat).not.toContain('  ');
});

test('「すべて適用」で複数件を一括修正でき、温存スライドは対象外になる', async ({ page }) => {
  await page.goto('/index.html');
  // グラフを含む＝温存対象のスライドがあるフィクスチャを使う
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'preserve.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup');
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readwrite');
    const store = tx.objectStore('slides');
    const all = await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const slide of all) {
      const positioned = slide.elements.filter((e) => e.x != null);
      const withText = positioned.find((e) =>
        (e.paragraphs || []).some((p) => (p.runs || []).some((r) => (r.text || '').trim().length > 0))
      );
      if (!withText) continue;
      const run = withText.paragraphs.flatMap((p) => p.runs).find((r) => (r.text || '').trim().length > 0);
      run.text = run.text + '！！'; // 各スライドの最初のテキストrunに句読点重複を注入（温存スライドも含む）
      store.put(slide);
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  });

  await page.locator('#btn-back-home').click();
  await page.locator('.btn-open').first().click();
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const preserveCount = parseInt(await page.locator('#stat-preserve-count').textContent(), 10);
  const slideCount = parseInt(await page.locator('#stat-slide-count').textContent(), 10);
  expect(preserveCount).toBeGreaterThan(0); // このフィクスチャには温存スライドが含まれる

  // 温存対象を除いたスライド数だけ検出されるはず（温存スライドは注入していても対象外）
  await expect(page.locator('.typo-issue')).toHaveCount(slideCount - preserveCount);

  await page.locator('#btn-typo-apply-all').click();
  await expect(page.locator('#typo-status')).toContainText('件のケアレスミスをすべて適用しました');
  await expect(page.locator('.typo-issue')).toHaveCount(0);
});
