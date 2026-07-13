// bt13: 一括生成でテキストが不一致になった場合、「何が変わったか」を
// 具体的に確認できる差分表示が機能することを検証する。
// （バッジで「不一致」と分かるだけでは原因調査ができないため追加した機能）
const { test, expect } = require('@playwright/test');
const path = require('path');

test('テキスト不一致時に、元⇔生成後の差分がハイライト表示される', async ({ page }) => {
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

  await page.locator('#btn-copy-gen-batch').click();
  await page.locator('#paste-gen-response').fill(JSON.stringify({
    pages: [
      {
        // フィクスチャの実際の構造（タイトルと本文は別々のテキストボックス）に合わせ、
        // 2要素に分けて渡す。1要素・2段落にすると段落区切りの"\n"が生成後テキストにだけ
        // 入り、意図した言い換え以外の箇所まで差分としてハイライトされてしまうため。
        index: 0,
        elements: [
          {
            type: 'shape', x: 0.5, y: 0.3, w: 9, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: [{ align: 'left', runs: [{ text: 'フィクスチャC' }] }],
          },
          {
            type: 'shape', x: 0.5, y: 1.5, w: 9, h: 2, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: [{ align: 'left', runs: [{ text: 'スライドCの内容、これが最後のページです。' }] }], // 意図的な言い換え
          },
        ],
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
          paragraphs: [
            { align: 'left', runs: [{ text: 'フィクスチャA' }] },
            { align: 'left', runs: [{ text: 'これはスライドAの本文です。改行テスト。' }] },
            { align: 'left', runs: [{ text: '二行目のテキスト。' }] },
          ],
        }],
      },
    ],
  }));
  await page.locator('#btn-load-gen-response').click();
  await expect(page.locator('#gen-status')).toContainText('不一致 1枚');

  // 差分表示のトグルは不一致のカードにのみ存在する
  await expect(page.locator('#gen-review-grid .diff-details')).toHaveCount(1);

  await page.locator('#gen-review-grid .diff-details summary').click();
  const diffText = page.locator('#gen-review-grid .diff-text');
  await expect(diffText.locator('del')).toHaveCount(2); // "本文"→"内容"、"スライド"→"ページ" の2箇所
  await expect(diffText.locator('ins')).toHaveCount(2);
  await expect(diffText).toContainText('本文');
  await expect(diffText).toContainText('内容');
});
