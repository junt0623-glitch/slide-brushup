// bt02: image.pptx を解析し、画像がバイト単位で無改変のまま保存され、
// 同一画像が重複排除されることを確認する。
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const expectations = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'expectations.json'), 'utf-8')
);

test('image.pptxの画像がバイト単位で一致し、重複排除される', async ({ page }) => {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'image.pptx'));
  await page.waitForSelector('#screen-analysis:not([hidden])', { timeout: 20000 });

  await expect(page.locator('#stat-slide-count')).toHaveText('2');
  // 2枚のスライドが同一画像を参照するため、重複排除後は1件
  await expect(page.locator('#stat-image-count')).toHaveText('1');

  const mediaRecords = await page.evaluate(async () => {
    const dbReq = indexedDB.open('slide-brushup', 1);
    const db = await new Promise((res, rej) => {
      dbReq.onsuccess = () => res(dbReq.result);
      dbReq.onerror = () => rej(dbReq.error);
    });
    const tx = db.transaction(['media'], 'readonly');
    return new Promise((res, rej) => {
      const r = tx.objectStore('media').getAll();
      r.onsuccess = () => res(r.result.map((m) => ({ mediaId: m.mediaId, byteHash: m.byteHash })));
      r.onerror = () => rej(r.error);
    });
  });

  expect(mediaRecords).toHaveLength(1);
  expect(mediaRecords[0].byteHash).toBe(expectations['image.pptx'].imageSha256);
});
