// bt16: かんたんブラッシュアップ（無料・ガイド付きフロー）を検証する。
//   ・①ページ要約と②全体構成分析が1つの統合プロンプトにまとまり、往復1回で分析が完了する
//   ・貼り付け欄は1つで、回答の種類（分析/ページ生成）を形から自動判別して読み込む
//   ・インポート→分析→デザイン採用→ページ生成完了→書き出しステップまで、
//     Anthropic APIへの通信が一切ないまま（＝無料のまま）到達できることを確認する
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const EASY_ANALYSIS_MOCK = JSON.stringify({
  pageSummaries: [
    { index: 0, title: 'C', oneLiner: 'c', role: '表紙' },
    { index: 1, title: 'B', oneLiner: 'b', role: '本文' },
    { index: 2, title: 'A', oneLiner: 'a', role: 'まとめ' },
  ],
  keyMessages: ['m1', 'm2'],
  splitMergePlan: [],
  repeatPlan: [],
  designSystems: [0, 1, 2].map((i) => ({
    name: `かんたん案${i + 1}`,
    concept: 'c',
    palette: { primary: '#222222', secondary: '#888888', accent: '#c08a3e', background: '#ffffff' },
    typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 },
    notes: '',
    previews: [{ pageIndex: 0, blocks: [] }],
  })),
});

async function importFixture(page) {
  // claude.aiを実際に開かないよう、window.openを記録用スタブに差し替える
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.open = (url) => {
      window.__openedUrls.push(String(url));
      return null;
    };
  });
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });
}

test('かんたんフロー: 統合分析→デザイン採用→ページ生成→書き出しステップまでAPIなしで進められる', async ({ page }) => {
  let apiCalled = false;
  page.on('request', (req) => {
    if (req.url().includes('api.anthropic.com')) apiCalled = true;
  });

  await importFixture(page);

  // ステップ1: 統合分析プロンプトのコピー＋claude.aiを開く
  await expect(page.locator('#easy-section')).toBeVisible();
  await expect(page.locator('.easy-steps li').nth(0)).toHaveClass(/is-active/);
  await page.locator('#btn-easy-action').click();
  const clip1 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip1).toContain('pageSummaries'); // ①要約と…
  expect(clip1).toContain('designSystems'); // …②デザイン分析が
  expect(clip1).toContain('36pt'); // 1つのプロンプトに統合されている
  const opened = await page.evaluate(() => window.__openedUrls);
  expect(opened.some((u) => u.includes('claude.ai'))).toBe(true);

  // 統合回答を貼り付け→要約とデザイン案の両方が一度に読み込まれ、ステップ2へ
  await page.locator('#easy-paste-area').fill(EASY_ANALYSIS_MOCK);
  await page.locator('#btn-easy-load').click();
  await page.waitForSelector('#easy-status.is-success', { timeout: 5000 });
  await expect(page.locator('.design-card')).toHaveCount(3);
  await expect(page.locator('.easy-steps li').nth(1)).toHaveClass(/is-active/);

  // ステップ2: デザイン案を採用すると自動でステップ3（ページ生成）へ進む
  await page.locator('.design-card').nth(0).locator('button').click();
  await expect(page.locator('.easy-steps li').nth(2)).toHaveClass(/is-active/);
  await expect(page.locator('#gen-section')).toBeVisible();

  // ステップ3: 生成プロンプトをコピー（既定バッチ3で全3ページが含まれる）
  await page.locator('#btn-easy-action').click();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip2).toContain('"tid"');
  expect(clip2).toContain('"index":0');
  expect(clip2).toContain('"index":2');

  // プロンプト内の<pages>入力をそのまま返す＝テキスト無改変の理想的な応答を貼り付ける
  const pagesInput = JSON.parse(/<pages>\n([\s\S]*?)\n<\/pages>/.exec(clip2)[1]);
  const genResponse = {
    pages: pagesInput.pages.map((p) => ({ index: p.index, elements: p.elements })),
  };
  await page.locator('#easy-paste-area').fill(JSON.stringify(genResponse));
  await page.locator('#btn-easy-load').click();
  await expect(page.locator('#easy-status')).toContainText('すべてのページが完了');

  // 全ページ「テキスト一致」で、ステップ4（書き出し）に進んでいる
  await expect(page.locator('#gen-review-grid .gen-badge--ok')).toHaveCount(3);
  await expect(page.locator('.easy-steps li').nth(3)).toHaveClass(/is-active/);
  await expect(page.locator('#btn-easy-action')).toContainText('書き出す');

  await page.waitForTimeout(300);
  expect(apiCalled).toBe(false); // Anthropic APIへの通信が一切発生していない
});

test('貼り付けだけで自動読み込みされ、APIモードではかんたんフローが隠れる', async ({ page }) => {
  await importFixture(page);

  // 貼り付けイベントで（読み込みボタンを押さずに）自動で読み込まれる
  await page.locator('#easy-paste-area').evaluate((el, text) => {
    el.value = text;
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
  }, EASY_ANALYSIS_MOCK);
  await page.waitForSelector('#easy-status.is-success', { timeout: 5000 });
  await expect(page.locator('.design-card')).toHaveCount(3);
  await expect(page.locator('.easy-steps li').nth(1)).toHaveClass(/is-active/);

  // 従来セクション側のボタン状態も同期されている（②のコピーが有効化）
  await expect(page.locator('#btn-copy-design-prompt')).toBeEnabled();

  // APIキー自動実行モードに切り替えると、かんたんフロー（無料の近道）は隠れる
  await page.locator('#ai-mode-api').check();
  await expect(page.locator('#easy-section')).toBeHidden();
  await page.locator('#ai-mode-manual').check();
  await expect(page.locator('#easy-section')).toBeVisible();
});
