// bt14: Phase 4で承認した生成結果(genElements)が、Phase 2の「pptxを書き出す」で
// 実際に使われることを検証する。これが欠けていると、④で再構築しても書き出しには
// 反映されない（実際に発生していた不具合）。
// あわせて、意図的にテキストが不一致のまま承認したスライドがあっても、
// 検証（textHashMatch）が「承認済みの内容」を基準に正しくOK判定されることも確認する。
const { test, expect } = require('@playwright/test');
const path = require('path');

test('Phase4で承認した生成結果が書き出しに反映され、検証もOKになる', async ({ page }) => {
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
      palette: { primary: '#1A3C34', secondary: '#888888', accent: '#c08a3e', background: '#ffffff' },
      typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 }, notes: '',
      previews: [{ pageIndex: 0, blocks: [] }],
    })),
  }));
  await page.locator('#btn-load-design-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });
  await page.locator('.design-card').nth(0).locator('button').click();

  await page.locator('#btn-copy-gen-batch').click();
  await page.locator('#paste-gen-response').fill(JSON.stringify({
    pages: [
      {
        index: 0,
        elements: [
          { type: 'shape', x: 0.3, y: 0.3, w: 9, h: 1, shapeType: 'rect', isTextBox: false,
            fill: { type: 'solid', color: '#1A3C34' }, line: null, paragraphs: [] },
          { type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: [{ align: 'left', runs: [{ text: 'フィクスチャC' }] }, { align: 'left', runs: [{ text: 'スライドCの本文、これが最後のスライドです。' }] }] },
        ],
      },
      { index: 1, elements: [{ type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [{ align: 'left', runs: [{ text: 'フィクスチャB' }] }, { align: 'left', runs: [{ text: 'スライドBの本文、太字ランを含みます。' }] }] }] },
      { index: 2, elements: [{ type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [{ align: 'left', runs: [{ text: 'フィクスチャA' }] }, { align: 'left', runs: [{ text: '意図的に不一致のまま承認するテスト用テキスト' }] }] }] },
    ],
  }));
  await page.locator('#btn-load-gen-response').click();
  await expect(page.locator('#gen-status')).toContainText('不一致 1枚');

  // 不一致のスライド(3枚目)をあえて承認する
  const mismatchCheckbox = page.locator('#gen-review-grid .slide-card').nth(2).locator('.gen-approve-label input');
  await expect(mismatchCheckbox).not.toBeChecked();
  await mismatchCheckbox.check();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-build-output').click(),
  ]);
  await page.waitForSelector('#build-result:not([hidden])');
  // 承認済みの内容を基準に検証されるため、意図的な不一致があってもNGバッジは出ない
  await expect(page.locator('#build-result .verify-badge.ng')).toHaveCount(0);

  const fs = require('fs');
  const os = require('os');
  const outPath = path.join(os.tmpdir(), `bt14-${Date.now()}.pptx`);
  await download.saveAs(outPath);
  expect(fs.existsSync(outPath)).toBe(true);
});
