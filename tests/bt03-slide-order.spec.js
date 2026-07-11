// bt03: basic.pptx は意図的に「ファイル名の物理順(slide1/2/3.xml=A,B,C)」と
// 「sldIdLstが定める論理表示順(C,B,A)」をズラして作られている。
// ファイル名ソートで誤解決する実装だとA,B,C順になってしまうため、
// このテストは rels 経由の正しい解決を検証する。
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const expectations = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'expectations.json'), 'utf-8')
);

test('スライド順はファイル名ではなくrelsで解決される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'basic.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  const cards = page.locator('#slide-grid .slide-card');
  const order = [];
  for (let i = 0; i < 3; i++) {
    const card = cards.nth(i);
    await card.locator('summary').click();
    const text = await card.locator('pre').innerText();
    const m = text.match(/フィクスチャ([A-C])/);
    order.push(m ? m[1] : null);
  }

  const expectedTitles = expectations['basic.pptx'].titlesInOrder; // ["フィクスチャC", ...]
  const expectedLetters = expectedTitles.map((t) => t.replace('フィクスチャ', ''));
  expect(order).toEqual(expectedLetters); // ["C", "B", "A"]
});
