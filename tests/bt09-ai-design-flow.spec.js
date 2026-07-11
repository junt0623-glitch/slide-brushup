// bt09: Phase 3のAI連携フローを、実際のClaude API呼び出しをモックして検証する。
// （このリポジトリのCI環境にはAPIキーを持たせない方針のため、page.routeで
//   fetch('https://api.anthropic.com/v1/messages') を横取りし、実際のAPIと
//   同じレスポンス形式で応答することで、UI〜保存までの配線を検証する。
//   実際のAPIとの疎通そのものは、開発者が手元でAPIキーを使って確認すること。）
const { test, expect } = require('@playwright/test');
const path = require('path');

function mockAnthropicResponse(jsonBody) {
  return { content: [{ type: 'text', text: JSON.stringify(jsonBody) }], usage: {} };
}

const SUMMARY_MOCK = [
  { index: 0, title: 'フィクスチャC', oneLiner: 'スライドCの要約', role: '表紙' },
  { index: 1, title: 'フィクスチャB', oneLiner: 'スライドBの要約', role: '本文' },
  { index: 2, title: 'フィクスチャA', oneLiner: 'スライドAの要約', role: 'まとめ' },
];

const DESIGN_MOCK = {
  keyMessages: ['キーメッセージ1', 'キーメッセージ2', 'キーメッセージ3'],
  splitMergePlan: [{ targetIndices: [1], action: 'split', rationale: 'テスト根拠' }],
  repeatPlan: [{ message: '反復メッセージ', suggestedIndices: [0, 2], rationale: 'テスト根拠2' }],
  designSystems: [0, 1, 2].map((i) => ({
    name: `案${i + 1}`,
    concept: 'テストコンセプト',
    palette: { primary: '#22303C', secondary: '#8FA3B0', accent: '#C08A3E', background: '#FFFFFF' },
    typography: { titleFont: 'Serif', bodyFont: 'Sans', titleSizePt: 40, bodySizePt: 16 },
    notes: '',
    previews: [{ pageIndex: 0, blocks: [{ type: 'title', x: 0.5, y: 0.5, w: 8, h: 1, text: 'Title', colorRole: 'primary' }] }],
  })),
};

async function setupMockRoute(page) {
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const json = body.model.includes('haiku') ? SUMMARY_MOCK : DESIGN_MOCK;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnthropicResponse(json)) });
  });
}

test('APIキー未設定では実行できず、エラーメッセージが表示される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-ai-summary').click();
  await expect(page.locator('#ai-status')).toContainText('APIキー');
});

test('要約生成→全体構成分析→デザイン案選択が一通り機能し、永続化される', async ({ page }) => {
  await setupMockRoute(page);
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  // 設定
  await page.locator('#btn-ai-settings').click();
  await page.locator('#input-api-key').fill('sk-ant-test-dummy');
  await page.locator('#ai-settings-btn-save').click();

  // ① ページ要約
  await expect(page.locator('#btn-ai-design')).toBeDisabled();
  await page.locator('#btn-ai-summary').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await expect(page.locator('#btn-ai-design')).toBeEnabled();

  // ② 全体構成分析
  await page.locator('#btn-ai-design').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await expect(page.locator('#ai-plan-result')).toBeVisible();
  await expect(page.locator('#ai-key-messages li')).toHaveCount(3);
  await expect(page.locator('.design-card')).toHaveCount(3);

  // デザイン案の選択
  await page.locator('.design-card').nth(1).locator('button').click();
  await expect(page.locator('.design-card').nth(1)).toContainText('採用中');
  await expect(page.locator('.design-card').nth(1)).toHaveClass(/is-selected/);

  // 永続化の確認
  const projectState = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup', 2);
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['projects'], 'readonly');
    const all = await new Promise((res, rej) => { const r = tx.objectStore('projects').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  });
  expect(projectState.selectedDesignSystemIndex).toBe(1);
  expect(projectState.aiPlan.designSystems).toHaveLength(3);
});

test('APIエラー(401)・JSON解釈失敗時にエラーメッセージが表示され、再試行できる', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });
  await page.locator('#btn-ai-settings').click();
  await page.locator('#input-api-key').fill('sk-ant-invalid');
  await page.locator('#ai-settings-btn-save').click();

  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
  });
  await page.locator('#btn-ai-summary').click();
  await page.waitForSelector('#ai-status.is-error', { timeout: 10000 });
  await expect(page.locator('#ai-status')).toContainText('APIキーが無効');
  await expect(page.locator('#btn-ai-summary')).toBeEnabled();

  await page.unroute('https://api.anthropic.com/v1/messages');
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '普通の文章で回答します。' }] }),
    });
  });
  await page.locator('#btn-ai-summary').click();
  await page.waitForSelector('#ai-status.is-error', { timeout: 10000 });
  await expect(page.locator('#ai-status')).toContainText('JSON');
});
