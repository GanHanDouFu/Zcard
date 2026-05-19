const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('验证华谊兄弟演示卡整合流程', async ({ page }) => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const outDir = path.join(projectRoot, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.goto('http://localhost:32456', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-card-id="demo_huayi_downfall"]');
  await page.waitForSelector('[data-card-id="demo_huayi_bankruptcy"]');

  const initialCards = await page.evaluate(() => Array.from(document.querySelectorAll('.knowledge-card-wrap')).map((el) => ({
    id: el.dataset.cardId,
    title: el.querySelector('.card-title')?.textContent?.trim() || '',
    badge: el.querySelector('.card-badge')?.textContent?.trim() || ''
  })));

  await page.click('[data-card-id="demo_huayi_downfall"] .card-select-toggle');
  await page.click('[data-card-id="demo_huayi_bankruptcy"] .card-select-toggle');
  await page.waitForSelector('#batch-actions:not(.hidden)');

  const batchInfo = await page.evaluate(() => ({
    selectedNum: document.querySelector('#selected-num')?.textContent?.trim() || '',
    integrateText: document.querySelector('#btn-integrate')?.innerText?.trim() || ''
  }));

  await page.screenshot({ path: path.join(outDir, 'integrate-selected.png'), fullPage: true });
  await page.click('#btn-integrate');
  await page.waitForSelector('#integrate-preview-modal:not(.hidden)', { timeout: 50000 });

  const preview = await page.evaluate(() => ({
    title: document.querySelector('#integrate-preview-title')?.textContent?.trim() || '',
    text: document.querySelector('#integrate-preview-body')?.innerText?.trim() || ''
  }));

  await page.screenshot({ path: path.join(outDir, 'integrate-preview.png'), fullPage: true });
  await page.click('#btn-confirm-integrate');
  await page.waitForTimeout(1000);

  const finalCards = await page.evaluate(() => Array.from(document.querySelectorAll('.knowledge-card-wrap')).map((el) => ({
    id: el.dataset.cardId,
    title: el.querySelector('.card-title')?.textContent?.trim() || '',
    badge: el.querySelector('.card-badge')?.textContent?.trim() || ''
  })));

  const storedCards = await page.evaluate(() => JSON.parse(localStorage.getItem('douyin_cards') || '[]'));
  const generatedIntegrated = storedCards.find((card) => card.is_integrated || card.isIntegrated) || null;
  const sourceCardsStillExist = storedCards
    .filter((card) => card.id === 'demo_huayi_downfall' || card.id === 'demo_huayi_bankruptcy')
    .map((card) => card.id);

  const result = {
    initialCards,
    batchInfo,
    preview,
    finalCards,
    generatedIntegrated,
    sourceCardsStillExist,
    screenshots: [
      path.join(outDir, 'integrate-selected.png'),
      path.join(outDir, 'integrate-preview.png')
    ]
  };

  fs.writeFileSync(path.join(outDir, 'validate-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));

  expect(batchInfo.selectedNum).toBe('2');
  expect(preview.title).not.toBe('');
  expect(generatedIntegrated).toBeTruthy();
  expect(sourceCardsStillExist).toEqual([]);
});
