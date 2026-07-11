// bt06: 「pptxを書き出す」を実行し、書き出し後の自動検証（テキストハッシュ一致・
// 画像バイト一致・スライド数一致）がすべてOKになることを確認する。
// preserve.pptx は温存スライド（グラフ・SmartArt想定）を含むため、
// 実装引き継ぎ書§5の「最難関」＝ZIPレベルでの温存スライド注入も同時に検証する。
const { test, expect } = require('@playwright/test');
const path = require('path');

async function buildAndCheck(page, fixtureName) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', fixtureName));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  await page.waitForSelector('#build-result:not([hidden])', { timeout: 15000 });

  const ngCount = await page.locator('#build-result .verify-badge.ng').count();
  expect(ngCount, `${fixtureName}: 検証NG件数`).toBe(0);
  expect(await download.path()).toBeTruthy();
}

test('画像を含むデッキの書き出し・往復検証がすべてOKになる', async ({ page }) => {
  await buildAndCheck(page, 'image.pptx');
});

test('温存スライド（グラフ含む）を含むデッキの書き出し・注入・往復検証がすべてOKになる', async ({ page }) => {
  await buildAndCheck(page, 'preserve.pptx');
});

test('図形を含むデッキの書き出し・往復検証がすべてOKになる', async ({ page }) => {
  await buildAndCheck(page, 'shapes.pptx');
});
