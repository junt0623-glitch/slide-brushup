// bt15: ページ生成時の「tidによる原文復元」を検証する。
//   各runには安定ID(tid)が付与され、AIにはtidの保持を求める。読み込み時、
//   システムはtidを頼りに元テキストを引き当てて上書きする。
//   → AIがうっかり言い換えても、tidさえ正しければ最終的な文字列は必ず原文に一致する
//     （バッチを大きくすると不一致が増える問題への対策）。
//   tidが欠落して復元できない場合は、従来通り不一致として検出される。
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function getToGen(page) {
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

test('プロンプトにtidが含まれる', async ({ page }) => {
  await getToGen(page);
  await page.locator('#btn-copy-gen-batch').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/"tid":\s*"\d+-\d+-\d+"/);
});

test('tidが正しければ、AIがテキストを言い換えても原文に復元されて一致判定になる', async ({ page }) => {
  await getToGen(page);
  await page.locator('#btn-copy-gen-batch').click();

  // 元スライド0の構造(2要素: タイトル1run + 本文1run+改行)を保ちつつ、textだけ全て言い換える。
  // tidは正しく保持しているので、復元により一致するはず。
  const genResponse = {
    pages: [
      {
        index: 0,
        elements: [
          {
            type: 'shape', x: 0.5, y: 0.5, w: 8, h: 1, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: [{ align: 'left', runs: [{ tid: '0-0-0', text: '言い換えたタイトル', bold: true }] }],
          },
          {
            type: 'shape', x: 0.5, y: 2, w: 8, h: 2, shapeType: 'rect', isTextBox: true, fill: null, line: null,
            paragraphs: [
              { align: 'left', runs: [{ tid: '1-0-0', text: '言い換えた本文' }] },
              { align: 'left', runs: [{ tid: '1-1-0', text: '', break: true }] },
            ],
          },
        ],
      },
    ],
  };
  await page.locator('#paste-gen-response').fill(JSON.stringify(genResponse));
  await page.locator('#btn-load-gen-response').click();
  await expect(page.locator('#gen-status')).not.toContainText('不一致');

  // 保存された生成結果のテキストが原文に戻っていること
  const restored = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup', 2);
    const db = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = () => rej(dbReq.error); });
    const tx = db.transaction(['slides'], 'readonly');
    const all = await new Promise((res, rej) => { const r = tx.objectStore('slides').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    all.sort((a, b) => a.index - b.index);
    return (all[0].genElements || [])
      .flatMap((e) => (e.paragraphs || []).flatMap((p) => (p.runs || []).map((r) => r.text)))
      .join('');
  });
  expect(restored).not.toContain('言い換えた');
  expect(restored).toContain('フィクスチャC');
});

test('tidが欠落して原文復元できない場合は、従来通り不一致として検出される', async ({ page }) => {
  await getToGen(page);
  await page.locator('#btn-copy-gen-batch').click();

  const genResponse = {
    pages: [
      {
        index: 0,
        elements: [{
          type: 'shape', x: 0.5, y: 0.5, w: 8, h: 2, shapeType: 'rect', isTextBox: true, fill: null, line: null,
          paragraphs: [{ align: 'left', runs: [{ text: 'tidを付けずに書き換えた全く違う本文' }] }],
        }],
      },
    ],
  };
  await page.locator('#paste-gen-response').fill(JSON.stringify(genResponse));
  await page.locator('#btn-load-gen-response').click();
  await expect(page.locator('#gen-status')).toContainText('不一致');
  await expect(page.locator('#gen-review-grid .diff-details')).toHaveCount(1);
});
