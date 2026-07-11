// bt05: shapes.pptx（テキストなし矩形／矢印／テキスト入り角丸四角形）を解析し、
// 図形ツールが塗り・線・形状タイプ込みでブラッシュアップ対象として認識されることを確認する。
const { test, expect } = require('@playwright/test');
const path = require('path');

test('テキストを持たない図形も含め、図形ツールが要素として認識される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'shapes.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const elements = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup', 1);
    const db = await new Promise((res, rej) => {
      dbReq.onsuccess = () => res(dbReq.result);
      dbReq.onerror = () => rej(dbReq.error);
    });
    const tx = db.transaction(['slides'], 'readonly');
    const all = await new Promise((res, rej) => {
      const r = tx.objectStore('slides').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return all[0].elements;
  });

  expect(elements).toHaveLength(4);

  const rect = elements.find((e) => e.shapeType === 'rect');
  expect(rect).toBeTruthy();
  expect(rect.fill.color).toBe('#1A7A5E');
  expect(rect.line.color).toBe('#000000');

  const arrow = elements.find((e) => e.shapeType === 'rightArrow');
  expect(arrow).toBeTruthy();
  expect(arrow.fill.color).toBe('#C08A3E');

  const labeled = elements.find((e) => e.shapeType === 'roundRect');
  expect(labeled).toBeTruthy();
  expect(labeled.paragraphs[0].runs[0].text).toBe('ラベル付き図形');

  // 塗り未指定＝<p:style>のテーマ参照のみの図形（PowerPointの図形ツールの既定状態）。
  // テーマ(accent1=4F81BD)への解決を検証する。これが「図形が全て消える」不具合の回帰テスト。
  const themed = elements.find((e) => e.shapeType === 'ellipse');
  expect(themed).toBeTruthy();
  expect(themed.isTextBox).toBe(false);
  expect(themed.fill.color).toBe('#4F81BD');
  expect(themed.fill.fromStyle).toBe(true);
});
