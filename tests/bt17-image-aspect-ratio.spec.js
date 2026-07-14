// bt17: 一括ページ生成で、AIが画像を歪んだサイズ(元の縦横比と異なるw/h)で
// 返してきても、書き出し・レビュー表示に使われるgenElements上では
// 元の縦横比へ機械的に補正されることを検証する。
//   （プロンプトで「縦横比を変えないこと」と指示するだけでは徹底できないため、
//    tidによる原文テキスト復元と同じ考え方で、読み込み時に機械的に補正する）
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function getToDesignSelected(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'image.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-copy-summary-prompt').click();
  await page.locator('#paste-summary-response').fill(JSON.stringify([
    { index: 0, title: 'S1', oneLiner: 's1', role: '本文' },
    { index: 1, title: 'S2', oneLiner: 's2', role: '本文' },
  ]));
  await page.locator('#btn-load-summary-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });

  await page.locator('#btn-copy-design-prompt').click();
  await page.locator('#paste-design-response').fill(JSON.stringify({
    keyMessages: ['m1'], splitMergePlan: [], repeatPlan: [],
    designSystems: [0, 1, 2].map((i) => ({
      name: `案${i + 1}`, concept: 'c',
      palette: { primary: '#222222', secondary: '#888888', accent: '#c08a3e', background: '#ffffff' },
      typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 }, notes: '',
      previews: [{ pageIndex: 0, blocks: [] }],
    })),
  }));
  await page.locator('#btn-load-design-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });

  await page.locator('.design-card').nth(0).locator('button').click();
  await page.waitForTimeout(300);
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

test('AIが画像を歪んだサイズで返しても、元の縦横比へ機械的に補正される', async ({ page }) => {
  await getToDesignSelected(page);

  // 実際のmediaIdと元の縦横比は、コピーされたプロンプト(元データそのまま)から取得する
  // （mediaIdは画像バイトのハッシュから決まるため、テスト側では予測できない）
  await page.locator('#btn-copy-gen-batch').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const pagesInput = JSON.parse(/<pages>\n([\s\S]*?)\n<\/pages>/.exec(clip)[1]);
  const page0 = pagesInput.pages.find((p) => p.index === 0);
  const imageEl = page0.elements.find((e) => e.type === 'image');
  expect(imageEl).toBeTruthy();
  const originalAspect = imageEl.w / imageEl.h; // フィクスチャ上は 2in / 1.333in ≈ 1.5

  // AIが縦横比を無視し、大きく歪んだ枠(幅6・高さ1＝アスペクト比6)を提案してきたケースを模擬する
  const distortedBox = { x: 0.5, y: 0.5, w: 6, h: 1 };
  const genResponse = {
    pages: [
      {
        index: 0,
        elements: [{ type: 'image', ...distortedBox, mediaId: imageEl.mediaId }],
      },
      {
        index: 1,
        elements: pagesInput.pages.find((p) => p.index === 1).elements,
      },
    ],
  };
  await page.locator('#paste-gen-response').fill(JSON.stringify(genResponse));
  await page.locator('#btn-load-gen-response').click();
  await page.waitForSelector('#gen-status.is-success, #gen-status.is-error', { timeout: 5000 });

  const genElements = await readGenElements(page, 0);
  const img = genElements.find((e) => e.type === 'image');

  // 縦横比は元の画像と一致（歪みが補正されている）
  expect(img.w / img.h).toBeCloseTo(originalAspect, 2);
  // AIが提案した枠の外にはみ出さず、枠内に収まっている（配置の意図は尊重する）
  expect(img.w).toBeLessThanOrEqual(distortedBox.w + 1e-6);
  expect(img.h).toBeLessThanOrEqual(distortedBox.h + 1e-6);
  // 枠の中央に配置し直されている
  expect(img.x + img.w / 2).toBeCloseTo(distortedBox.x + distortedBox.w / 2, 5);
  expect(img.y + img.h / 2).toBeCloseTo(distortedBox.y + distortedBox.h / 2, 5);
});
