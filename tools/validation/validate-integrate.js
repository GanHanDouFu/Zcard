const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on('dialog', async (dialog) => {
    console.log('DIALOG:' + dialog.message());
    await dialog.accept();
  });

  const projectRoot = path.resolve(__dirname, '..', '..');
  const outDir = path.join(projectRoot, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto('http://localhost:32456', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-card-id="demo_huayi_downfall"]', { timeout: 15000 });
  await page.waitForSelector('[data-card-id="demo_huayi_bankruptcy"]', { timeout: 15000 });

  const initialCards = await page.evaluate(() => Array.from(document.querySelectorAll('.knowledge-card-wrap')).map((el) => ({
    id: el.dataset.cardId,
    title: el.querySelector('.card-title')?.textContent?.trim() || '',
    badge: el.querySelector('.card-badge')?.textContent?.trim() || ''
  })));

  await page.click('[data-card-id="demo_huayi_downfall"] .card-select-toggle');
  await page.click('[data-card-id="demo_huayi_bankruptcy"] .card-select-toggle');
  await page.waitForSelector('#batch-actions:not(.hidden)', { timeout: 5000 });

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
  const sourceCardsStillExist = storedCards.filter((card) => card.id === 'demo_huayi_downfall' || card.id === 'demo_huayi_bankruptcy').map((card) => card.id);

  console.log(JSON.stringify({
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
  }, null, 2));

  await browser.close();
})().catch((error) => {
  console.error('VALIDATION_ERROR');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
