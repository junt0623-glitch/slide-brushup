// bt01: basic.pptx を解析し、全スライドのテキストが期待通り抽出されることを確認する。
const { test, expect } = require('@playwright/test');
const path = require('path');

test('basic.pptxの全スライドからテキストが一字一句抽出される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await expect(page.locator('#stat-slide-count')).toHaveText('3');
  await expect(page.locator('#stat-preserve-count')).toHaveText('0');

  const cards = page.locator('#slide-grid .slide-card');
  await expect(cards).toHaveCount(3);

  // details/summary を開いて中身のテキストを取得する
  const texts = [];
  for (let i = 0; i < 3; i++) {
    const card = cards.nth(i);
    await card.locator('summary').click();
    texts.push(await card.locator('pre').innerText());
  }

  expect(texts[0]).toContain('フィクスチャC');
  expect(texts[0]).toContain('スライドCの本文、これが最後のスライドです。');
  expect(texts[1]).toContain('フィクスチャB');
  expect(texts[1]).toContain('太字ランを含みます');
  expect(texts[2]).toContain('フィクスチャA');
  expect(texts[2]).toContain('改行テスト');
  expect(texts[2]).toContain('二行目のテキスト');
});

test('非対応形式(.pptx以外)はエラーメッセージを表示する', async ({ page }) => {
  await page.goto('/index.html');
  // ダミーのテキストファイルを .txt として渡す
  await page.setInputFiles('#file-input', {
    name: 'dummy.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a pptx'),
  });
  await expect(page.locator('#parse-status')).toContainText('.pptx', { timeout: 5000 });
  await expect(page.locator('#parse-status')).toHaveClass(/is-error/);
});
