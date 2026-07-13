// bt04: preserve.pptx（グラフ / 表 / 通常テキスト / SmartArt想定 の4枚構成）を解析し、
// 「温存」フラグが意図通りに立つ／立たないことを確認する。
// 表は再構築対象（温存不要）、グラフ・SmartArtは温存対象という区別がポイント。
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const expectations = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'expectations.json'), 'utf-8')
);

test('グラフ・SmartArtは温存対象、表・通常テキストは温存対象外と判定される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'preserve.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await expect(page.locator('#stat-slide-count')).toHaveText('4');
  await expect(page.locator('#stat-preserve-count')).toHaveText('2'); // chart + smartart

  const actual = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup'); // バージョン省略＝アプリが作成した既存DBをそのまま開く
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
    all.sort((a, b) => a.index - b.index);
    return all.map((s) => ({ index: s.index, preserve: s.preserve, reasons: s.preserveReasons, textConcat: s.textConcat }));
  });

  for (const exp of expectations['preserve.pptx'].expectedPreserve) {
    const act = actual[exp.index];
    expect(act.preserve, `slide[${exp.index}]`).toBe(exp.preserve);
    if (exp.reason) expect(act.reasons).toContain(exp.reason);
  }

  // 表(index=1)の中身は「温存」ではなく実データとして抽出されていること
  expect(actual[1].preserve).toBe(false);
  expect(actual[1].textConcat).toContain('項目');
  expect(actual[1].textConcat).toContain('テスト行');
  expect(actual[1].textConcat).toContain('123');
});
