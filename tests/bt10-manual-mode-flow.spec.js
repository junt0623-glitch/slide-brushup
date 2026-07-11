// bt10: 「手動コピペモード」（APIキー不要・無料）の一連の流れを検証する。
//   ① プロンプトをコピー→(claude.aiに貼り付けたと仮定して)応答を貼り付け→読み込み
//   ② も同様。Anthropic APIへの通信が一切発生しないことも確認する
//   （＝本当に無料で完結することの裏付け）。
const { test, expect } = require('@playwright/test');
const path = require('path');

const SUMMARY_MOCK_TEXT = JSON.stringify([
  { index: 0, title: 'フィクスチャC', oneLiner: 'スライドCの要約', role: '表紙' },
  { index: 1, title: 'フィクスチャB', oneLiner: 'スライドBの要約', role: '本文' },
  { index: 2, title: 'フィクスチャA', oneLiner: 'スライドAの要約', role: 'まとめ' },
]);

const DESIGN_MOCK_TEXT = JSON.stringify({
  keyMessages: ['メッセージ1', 'メッセージ2'],
  splitMergePlan: [],
  repeatPlan: [],
  designSystems: [0, 1, 2].map((i) => ({
    name: `手動案${i + 1}`,
    concept: 'コンセプト',
    palette: { primary: '#222222', secondary: '#888888', accent: '#c08a3e', background: '#ffffff' },
    typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 },
    notes: '',
    previews: [{ pageIndex: 0, blocks: [{ type: 'title', x: 0.5, y: 0.5, w: 8, h: 1, text: 'T', colorRole: 'primary' }] }],
  })),
});

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('デフォルトで無料の手動コピペモードが選ばれており、APIキーなしで完結する', async ({ page }) => {
  let apiCalled = false;
  page.on('request', (req) => {
    if (req.url().includes('api.anthropic.com')) apiCalled = true;
  });

  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await expect(page.locator('#ai-mode-manual')).toBeChecked();
  await expect(page.locator('#ai-manual-panel')).toBeVisible();
  await expect(page.locator('#ai-api-panel')).toBeHidden();
  await expect(page.locator('#btn-copy-design-prompt')).toBeDisabled();

  // ① プロンプトをコピー→貼り付けて読み込み
  await page.locator('#btn-copy-summary-prompt').click();
  const clip1 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip1).toContain('役割分類');

  await page.locator('#paste-summary-response').fill(SUMMARY_MOCK_TEXT);
  await page.locator('#btn-load-summary-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });
  await expect(page.locator('#btn-copy-design-prompt')).toBeEnabled();

  // ② プロンプトをコピー（①の結果が含まれているか）→貼り付けて読み込み
  await page.locator('#btn-copy-design-prompt').click();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip2).toContain('36pt');

  await page.locator('#paste-design-response').fill(DESIGN_MOCK_TEXT);
  await page.locator('#btn-load-design-response').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 5000 });
  await expect(page.locator('.design-card')).toHaveCount(3);
  await expect(page.locator('.design-card').first()).toContainText('手動案1');

  await page.waitForTimeout(300);
  expect(apiCalled).toBe(false); // Anthropic APIへの通信が一切発生していない
});
