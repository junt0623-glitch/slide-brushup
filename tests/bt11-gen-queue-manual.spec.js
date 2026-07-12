// bt11: 一括ページ生成キュー（Phase 4）の手動コピペモード（無料）を検証する。
//   ・デザインシステム採用後にgen-sectionが表示される
//   ・バッチ単位でのプロンプトコピーに正しいページが含まれる
//   ・テキストが完全一致するページ／一致しないページを両方含む応答を読み込ませ、
//     一致検証が個別に正しく機能することを確認する（Phase4の中核: 申告でなく実測検証）
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function getToDesignSelected(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-copy-summary-prompt').click();
  await page.locator('#paste-summary-response').fill(JSON.stringify([
    { index: 0, title: 'C', oneLiner: 'c', role: '表紙' },
    { index: 1, title: 'B', oneLiner: 'b', role: '本文' },
    { index: 2, title: 'A', oneLiner: 'a', role: 'まとめ' },
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

test('デザイン採用後にgen-sectionが表示され、バッチコピーに正しいページが含まれる', async ({ page }) => {
  await getToDesignSelected(page);

  await expect(page.locator('#gen-section')).toBeVisible();
  await expect(page.locator('#gen-active-design-name')).toHaveText('案1');
  await expect(page.locator('#gen-progress-text')).toContainText('対象3枚');

  await page.locator('#btn-copy-gen-batch').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('"index":0');
  expect(clip).toContain('"index":1');
  expect(clip).toContain('"index":2');
  expect(clip).toContain('#222222'); // 採用したデザインシステムの色
});

test('テキスト一致/不一致がページごとに正しく検証される', async ({ page }) => {
  await getToDesignSelected(page);

  const genResponse = {
    pages: [
      {
        index: 0,
        elements: [{
          type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [
            { align: 'left', runs: [{ text: 'フィクスチャC' }] },
            { align: 'left', runs: [{ text: 'スライドCの本文、これが最後のスライドです。' }] },
          ],
        }],
      },
      {
        index: 1,
        elements: [{
          type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [
            { align: 'left', runs: [{ text: 'フィクスチャB' }] },
            { align: 'left', runs: [{ text: 'スライドBの本文、太字ランを含みます。' }] },
          ],
        }],
      },
      {
        index: 2,
        elements: [{
          type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [{ align: 'left', runs: [{ text: '意図的に違う内容にした不一致テスト用テキスト' }] }],
        }],
      },
    ],
  };

  await page.locator('#paste-gen-response').fill(JSON.stringify(genResponse));
  await page.locator('#btn-load-gen-response').click();
  await expect(page.locator('#gen-status')).toContainText('不一致 1枚');

  const badges = page.locator('#gen-review-grid .gen-badge');
  await expect(badges).toHaveCount(3);
  await expect(page.locator('#gen-review-grid .slide-card').nth(0)).toContainText('テキスト一致');
  await expect(page.locator('#gen-review-grid .slide-card').nth(1)).toContainText('テキスト一致');
  await expect(page.locator('#gen-review-grid .slide-card').nth(2)).toContainText('テキスト不一致');

  // 一致したページはデフォルトで承認チェックが入っている
  await expect(page.locator('#gen-review-grid .slide-card').nth(0).locator('.gen-approve-label input')).toBeChecked();
});
