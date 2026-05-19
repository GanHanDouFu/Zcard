const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(projectRoot, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const newPageRes = await fetch('http://127.0.0.1:9227/json/new?http://localhost:32456', { method: 'PUT' });
  if (!newPageRes.ok) {
    throw new Error(`无法创建调试页面: ${newPageRes.status}`);
  }
  const target = await newPageRes.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let seq = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error.message || JSON.stringify(data.error)));
      else item.resolve(data.result);
      return;
    }
    const arr = listeners.get(data.method) || [];
    arr.forEach((fn) => fn(data.params || {}));
  };

  ws.onerror = (event) => {
    console.error('WS_ERROR', event.message || 'unknown');
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onclose = () => reject(new Error('WebSocket 已关闭'));
    setTimeout(() => reject(new Error('WebSocket 连接超时')), 10000);
  });

  function on(method, fn) {
    const arr = listeners.get(method) || [];
    arr.push(fn);
    listeners.set(method, arr);
  }

  function once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待事件超时: ${method}`)), timeoutMs);
      on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  function send(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalValue(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result ? result.result.value : undefined;
  }

  async function waitForExpression(expression, timeoutMs = 30000, intervalMs = 300) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await evalValue(expression);
      if (value) return value;
      await sleep(intervalMs);
    }
    throw new Error(`等待条件超时: ${expression}`);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false
  });

  const loadFired = once('Page.loadEventFired', 30000);
  await send('Page.navigate', { url: 'http://localhost:32456' });
  await loadFired;

  await waitForExpression("!!document.querySelector('[data-card-id=\"demo_huayi_downfall\"]') && !!document.querySelector('[data-card-id=\"demo_huayi_bankruptcy\"]')", 15000);

  const initialCards = await evalValue(`JSON.stringify(Array.from(document.querySelectorAll('.knowledge-card-wrap')).map((el) => ({
    id: el.dataset.cardId,
    title: el.querySelector('.card-title')?.textContent?.trim() || '',
    badge: el.querySelector('.card-badge')?.textContent?.trim() || ''
  })))`);

  await evalValue(`(() => {
    document.querySelector('[data-card-id="demo_huayi_downfall"] .card-select-toggle').click();
    document.querySelector('[data-card-id="demo_huayi_bankruptcy"] .card-select-toggle').click();
    return true;
  })()`);

  await waitForExpression("document.querySelector('#batch-actions') && !document.querySelector('#batch-actions').classList.contains('hidden')", 5000);

  const batchInfo = JSON.parse(await evalValue(`JSON.stringify({
    selectedNum: document.querySelector('#selected-num')?.textContent?.trim() || '',
    integrateText: document.querySelector('#btn-integrate')?.innerText?.trim() || ''
  })`));

  const selectedShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'integrate-selected-cdp.png'), Buffer.from(selectedShot.data, 'base64'));

  await evalValue(`document.querySelector('#btn-integrate').click(); true;`);
  await waitForExpression("document.querySelector('#integrate-preview-modal') && !document.querySelector('#integrate-preview-modal').classList.contains('hidden')", 50000, 500);

  const preview = JSON.parse(await evalValue(`JSON.stringify({
    title: document.querySelector('#integrate-preview-title')?.textContent?.trim() || '',
    text: document.querySelector('#integrate-preview-body')?.innerText?.trim() || ''
  })`));

  const previewShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'integrate-preview-cdp.png'), Buffer.from(previewShot.data, 'base64'));

  await evalValue(`document.querySelector('#btn-confirm-integrate').click(); true;`);

  await waitForExpression(`(() => {
    const stored = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
    const hasIntegrated = stored.some((card) => card.is_integrated || card.isIntegrated);
    const hasDemo = stored.some((card) => card.id === 'demo_huayi_downfall' || card.id === 'demo_huayi_bankruptcy');
    return hasIntegrated && !hasDemo;
  })()`, 10000, 300);

  const finalCards = await evalValue(`JSON.stringify(Array.from(document.querySelectorAll('.knowledge-card-wrap')).map((el) => ({
    id: el.dataset.cardId,
    title: el.querySelector('.card-title')?.textContent?.trim() || '',
    badge: el.querySelector('.card-badge')?.textContent?.trim() || ''
  })))`);

  const storageInfo = JSON.parse(await evalValue(`JSON.stringify((() => {
    const stored = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
    return {
      generatedIntegrated: stored.find((card) => card.is_integrated || card.isIntegrated) || null,
      sourceCardsStillExist: stored.filter((card) => card.id === 'demo_huayi_downfall' || card.id === 'demo_huayi_bankruptcy').map((card) => card.id)
    };
  })())`));

  const result = {
    initialCards: JSON.parse(initialCards),
    batchInfo,
    preview,
    finalCards: JSON.parse(finalCards),
    generatedIntegrated: storageInfo.generatedIntegrated,
    sourceCardsStillExist: storageInfo.sourceCardsStillExist,
    screenshots: [
      path.join(outDir, 'integrate-selected-cdp.png'),
      path.join(outDir, 'integrate-preview-cdp.png')
    ]
  };

  fs.writeFileSync(path.join(outDir, 'validate-cdp-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));

  ws.close();
}

main().catch((error) => {
  console.error('VALIDATION_ERROR');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
