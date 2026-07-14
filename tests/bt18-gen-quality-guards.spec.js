// bt18: 一括ページ生成の品質ガード（機械的な検証・補正）を検証する。
//   ユーザー報告の劣化パターンへの対策:
//   ①テキスト要素の削除 → tid形式の応答で欠落を検出し、元の位置・内容のまま追補する
//   ②文字の極端な縮小 → デザインシステムの本文サイズを下限として機械的に引き上げる
//   ③画像の省略 → mediaIdで欠落を検出し、元の位置・サイズのまま追補する
//   ④バッチサイズに20ページの選択肢がある
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const DESIGN_MOCK = {
  keyMessages: ['m1'], splitMergePlan: [], repeatPlan: [],
  designSystems: [0, 1, 2].map((i) => ({
    name: `案${i + 1}`, concept: 'c',
    palette: { primary: '#222222', secondary: '#888888', accent: '#c08a3e', background: '#ffffff' },
    typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 }, notes: '',
    previews: [{ pageIndex: 0, blocks: [] }],
  })),
};

async function getToDesignSelected(page, fixture, summaries) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', fixture));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-copy-summary-prompt').click();
  await page.locator('#paste-summary-response').fill(JSON.stringify(summaries));
  await page.locator('#btn-load-summary-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });

  await page.locator('#btn-copy-design-prompt').click();
  await page.locator('#paste-design-response').fill(JSON.stringify(DESIGN_MOCK));
  await page.locator('#btn-load-design-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });

  await page.locator('.design-card').nth(0).locator('button').click();
  await page.waitForTimeout(300);
}

async function copyBatchAndParseInput(page) {
  await page.locator('#btn-copy-gen-batch').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  return JSON.parse(/<pages>\n([\s\S]*?)\n<\/pages>/.exec(clip)[1]);
}

async function loadGenResponse(page, genResponse) {
  await page.locator('#paste-gen-response').fill(JSON.stringify(genResponse));
  await page.locator('#btn-load-gen-response').click();
  await page.waitForSelector('#gen-status.is-success, #gen-status.is-error', { timeout: 5000 });
}

async function readGenElements(page, index) {
  return page.evaluate(async (idx) => {
    const dbReq = indexedDB.open('slide-brushup'); // バージョン省略＝アプリが作成した既存DBをそのまま開く
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readonly');
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const slide = all.find((s) => s.index === idx);
    return slide ? slide.genElements : null;
  }, index);
}

function flatText(elements) {
  return (elements || [])
    .filter((e) => e.type === 'shape' || e.type === 'text')
    .map((e) => (e.paragraphs || [])
      .map((p) => (p.runs || []).filter((r) => !r.break).map((r) => r.text || '').join(''))
      .join(''))
    .join('');
}

test('削除されたテキスト要素が追補され、極小フォントは本文サイズまで引き上げられる', async ({ page }) => {
  await getToDesignSelected(page, 'basic.pptx', [
    { index: 0, title: 'C', oneLiner: 'c', role: '表紙' },
    { index: 1, title: 'B', oneLiner: 'b', role: '本文' },
    { index: 2, title: 'A', oneLiner: 'a', role: 'まとめ' },
  ]);

  // バッチサイズに20ページの選択肢がある
  await expect(page.locator('#gen-batch-size option[value="20"]')).toHaveCount(1);

  const pagesInput = await copyBatchAndParseInput(page);
  const page0 = pagesInput.pages.find((p) => p.index === 0);
  expect(page0.elements.length).toBeGreaterThanOrEqual(2); // タイトル+本文の2要素

  // AIがタイトル要素だけを返し(しかも6ptに縮小)、本文要素を丸ごと削除してきたケースを模擬
  const titleEl = JSON.parse(JSON.stringify(page0.elements[0]));
  for (const p of titleEl.paragraphs) for (const r of p.runs) r.sizePt = 6;
  const genResponse = {
    pages: [
      { index: 0, elements: [titleEl] },
      ...pagesInput.pages.filter((p) => p.index !== 0).map((p) => ({ index: p.index, elements: p.elements })),
    ],
  };
  await loadGenResponse(page, genResponse);

  // 削除された本文要素が追補されるため、テキスト一致判定になる
  await expect(page.locator('#gen-status')).not.toContainText('不一致');
  const genElements = await readGenElements(page, 0);
  expect(flatText(genElements)).toContain('スライドCの本文、これが最後のスライドです。');

  // 6ptに縮小されたタイトルは、デザインシステムの本文サイズ(16pt)を下限として引き上げられる
  const restoredTitle = genElements.find((e) =>
    (e.paragraphs || []).some((p) => (p.runs || []).some((r) => typeof r.tid === 'string')));
  const sizes = restoredTitle.paragraphs.flatMap((p) => p.runs.filter((r) => !r.break).map((r) => r.sizePt));
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test('省略された画像がmediaIdで検出され、元の位置・サイズのまま追補される', async ({ page }) => {
  await getToDesignSelected(page, 'image.pptx', [
    { index: 0, title: 'S1', oneLiner: 's1', role: '本文' },
    { index: 1, title: 'S2', oneLiner: 's2', role: '本文' },
  ]);

  const pagesInput = await copyBatchAndParseInput(page);
  const page0 = pagesInput.pages.find((p) => p.index === 0);
  const origImage = page0.elements.find((e) => e.type === 'image');
  expect(origImage).toBeTruthy();

  // AIがテキストだけ返して画像を省略してきたケースを模擬
  const genResponse = {
    pages: [
      { index: 0, elements: page0.elements.filter((e) => e.type !== 'image') },
      ...pagesInput.pages.filter((p) => p.index !== 0).map((p) => ({ index: p.index, elements: p.elements })),
    ],
  };
  await loadGenResponse(page, genResponse);

  const genElements = await readGenElements(page, 0);
  const img = genElements.find((e) => e.type === 'image');
  expect(img).toBeTruthy();
  expect(img.mediaId).toBe(origImage.mediaId);
  expect(img.w).toBeCloseTo(origImage.w, 5); // 元のサイズのまま追補される
  expect(img.h).toBeCloseTo(origImage.h, 5);
  await expect(page.locator('#gen-status')).not.toContainText('不一致');
});
