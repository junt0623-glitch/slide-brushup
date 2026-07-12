// bt12: 一括ページ生成キュー（Phase 4）のAPIキー自動モードを検証する。
//   ・温存スライドは生成対象から除外される
//   ・一時停止→ページ再読込→再開で、未処理分だけが正しく再開される
//     （Phase4の完了条件そのもの: 「100ページ級で完走・中断再開」）
const { test, expect } = require('@playwright/test');
const path = require('path');

function mockAnthropicResponse(jsonBody) {
  return { content: [{ type: 'text', text: JSON.stringify(jsonBody) }], usage: {} };
}
const SUMMARY_MOCK_4 = [0, 1, 2, 3].map((i) => ({ index: i, title: `T${i}`, oneLiner: `o${i}`, role: '本文' }));
const DESIGN_MOCK = {
  keyMessages: ['m1'], splitMergePlan: [], repeatPlan: [],
  designSystems: [0, 1, 2].map((i) => ({
    name: `案${i + 1}`, concept: 'c',
    palette: { primary: '#222', secondary: '#888', accent: '#c08a3e', background: '#fff' },
    typography: { titleFont: 'S', bodyFont: 'S', titleSizePt: 40, bodySizePt: 16 }, notes: '',
    previews: [{ pageIndex: 0, blocks: [] }],
  })),
};

test('温存スライドは一括生成の対象から除外される', async ({ page }) => {
  const genCalled = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const userText = body.messages[0].content;
    let json;
    if (body.model.includes('haiku')) json = SUMMARY_MOCK_4;
    else if (userText.includes('<deck>')) json = DESIGN_MOCK;
    else {
      const m = userText.match(/"index":(\d+)/);
      const idx = m ? parseInt(m[1], 10) : -1;
      genCalled.push(idx);
      json = { pages: [{ index: idx, elements: [] }] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnthropicResponse(json)) });
  });

  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'preserve.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-ai-settings').click();
  await page.locator('#input-api-key').fill('sk-ant-test');
  await page.locator('#ai-settings-btn-save').click();
  await page.locator('#ai-mode-api').check();
  await page.locator('#btn-ai-summary').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await page.locator('#btn-ai-design').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await page.locator('.design-card').nth(0).locator('button').click();

  await expect(page.locator('#gen-progress-text')).toContainText('対象2枚');
  await expect(page.locator('#gen-progress-text')).toContainText('温存スキップ2枚');

  await page.locator('#btn-gen-start').click();
  await page.waitForSelector('#gen-status.is-success', { timeout: 15000 });
  await expect(page.locator('#gen-status')).toContainText('全2枚の処理が完了');

  expect(genCalled).not.toContain(0); // グラフ含有スライド(温存)
  expect(genCalled).not.toContain(3); // SmartArt想定スライド(温存)
  expect(genCalled.sort()).toEqual([1, 2]);
});

test('一時停止→再読込→再開で、未処理ページのみが重複なく処理される', async ({ page }) => {
  const callOrder = [];
  const PAGE_TEXTS = {
    0: ['フィクスチャC', 'スライドCの本文、これが最後のスライドです。'],
    1: ['フィクスチャB', 'スライドBの本文、太字ランを含みます。'],
    2: ['フィクスチャA', 'これはスライドAの本文です。改行テスト。', '二行目のテキスト。'],
  };
  const SUMMARY_MOCK_3 = [
    { index: 0, title: 'C', oneLiner: 'c', role: '表紙' },
    { index: 1, title: 'B', oneLiner: 'b', role: '本文' },
    { index: 2, title: 'A', oneLiner: 'a', role: 'まとめ' },
  ];

  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const userText = body.messages[0].content;
    let json;
    if (body.model.includes('haiku')) json = SUMMARY_MOCK_3;
    else if (userText.includes('<deck>')) json = DESIGN_MOCK;
    else {
      const m = userText.match(/"index":(\d+)/);
      const idx = m ? parseInt(m[1], 10) : 0;
      callOrder.push(idx);
      if (callOrder.length === 1) await new Promise((r) => setTimeout(r, 800));
      const texts = PAGE_TEXTS[idx] || ['?'];
      json = {
        pages: [{
          index: idx,
          elements: [{
            type: 'shape', x: 0.5, y: 0.5, w: 8, h: 2, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: texts.map((t) => ({ align: 'left', runs: [{ text: t }] })),
          }],
        }],
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnthropicResponse(json)) });
  });

  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await page.locator('#btn-ai-settings').click();
  await page.locator('#input-api-key').fill('sk-ant-test');
  await page.locator('#ai-settings-btn-save').click();
  await page.locator('#ai-mode-api').check();
  await page.locator('#btn-ai-summary').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await page.locator('#btn-ai-design').click();
  await page.waitForSelector('#ai-status.is-success', { timeout: 10000 });
  await page.locator('.design-card').nth(0).locator('button').click();

  // 生成開始→1枚目処理中(800ms待たせている)に一時停止
  await page.locator('#btn-gen-start').click();
  await page.waitForTimeout(200);
  await page.locator('#btn-gen-pause').click();
  await page.waitForSelector('#gen-status.is-success', { timeout: 15000 });
  await expect(page.locator('#gen-status')).toContainText('一時停止');

  const progressAfterPause = await page.locator('#gen-progress-text').innerText();
  const doneAfterPause = parseInt(progressAfterPause.match(/完了(\d+)枚/)[1], 10);
  expect(doneAfterPause).toBeLessThan(3);

  // 再読込（ブラウザを閉じて開き直す想定）
  await page.reload();
  await page.locator('.project-card .btn-open').first().click();
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });
  await expect(page.locator('#gen-progress-text')).toContainText(`完了${doneAfterPause}枚`);

  // 再開
  await page.locator('#ai-mode-api').check();
  await page.locator('#btn-gen-start').click();
  await page.waitForSelector('#gen-status.is-success', { timeout: 15000 });
  await expect(page.locator('#gen-status')).toContainText('全3枚の処理が完了');
  await expect(page.locator('#gen-progress-text')).toContainText('完了3枚');

  const uniqueIndices = new Set(callOrder);
  expect(callOrder.length).toBe(uniqueIndices.size); // 重複処理なし
});
