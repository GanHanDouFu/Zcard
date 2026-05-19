const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 8080);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const ROOT = __dirname;

// --- Live Reload (SSE) ---
const sseClients = new Set();
let debounceTimer = null;

function watchFiles() {
    const watchTargets = ['index.html', 'script.js', 'style.css'];
    for (const file of watchTargets) {
        try {
            fs.watch(path.join(ROOT, file), (eventType) => {
                if (eventType !== 'change') return;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    console.log(`[live-reload] ${file} changed, reloading ${sseClients.size} client(s)`);
                    for (const res of sseClients) {
                        res.write('data: reload\n\n');
                    }
                }, 150);
            });
        } catch (e) {
            console.warn(`[live-reload] cannot watch ${file}: ${e.message}`);
        }
    }
}

watchFiles();

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('请求内容过大'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// SSE 端点
function handleSSE(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.write('data: connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
}

async function handleDeepSeek(req, res) {
    if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    if (!DEEPSEEK_API_KEY) {
        return sendJson(res, 500, {
            error: '缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env 后填写密钥，或在页面设置里临时输入 API Key。'
        });
    }

    try {
        console.log('[deepseek] 收到请求');
        const { prompt } = JSON.parse(await readBody(req));
        if (!prompt || typeof prompt !== 'string') {
            return sendJson(res, 400, { error: '缺少 prompt' });
        }
        console.log('[deepseek] prompt 长度:', prompt.length);

        const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
        const requestBody = JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });

        const REQUEST_TIMEOUT = 20000; // 20秒超时

        let upstreamRes;
        if (proxyUrl) {
            const proxy = new URL(proxyUrl);
            console.log('[deepseek] 使用代理:', proxyUrl);
            upstreamRes = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`代理请求超时 (${REQUEST_TIMEOUT}ms): ${proxyUrl}`));
                }, REQUEST_TIMEOUT);

                const req = http.request({
                    hostname: proxy.hostname,
                    port: proxy.port,
                    path: 'https://api.deepseek.com/chat/completions',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Proxy-Connection': 'keep-alive',
                        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
                        'Content-Length': Buffer.byteLength(requestBody)
                    }
                }, (upstreamRes) => {
                    clearTimeout(timeoutId);
                    resolve(upstreamRes);
                });
                req.on('error', (e) => {
                    clearTimeout(timeoutId);
                    reject(new Error(`代理连接失败: ${e.message}`));
                });
                req.setTimeout(REQUEST_TIMEOUT, () => {
                    req.destroy();
                    clearTimeout(timeoutId);
                    reject(new Error(`代理请求超时 (${REQUEST_TIMEOUT}ms)`));
                });
                req.write(requestBody);
                req.end();
            });
        } else {
            console.log('[deepseek] 直连 DeepSeek API');
            upstreamRes = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`直连请求超时 (${REQUEST_TIMEOUT}ms)`));
                }, REQUEST_TIMEOUT);

                const req = https.request({
                    hostname: 'api.deepseek.com',
                    port: 443,
                    path: '/chat/completions',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
                        'Content-Length': Buffer.byteLength(requestBody)
                    }
                }, (upstreamRes) => {
                    clearTimeout(timeoutId);
                    resolve(upstreamRes);
                });
                req.on('error', (e) => {
                    clearTimeout(timeoutId);
                    reject(new Error(`HTTPS 连接失败: ${e.message}`));
                });
                req.setTimeout(REQUEST_TIMEOUT, () => {
                    req.destroy();
                    clearTimeout(timeoutId);
                    reject(new Error(`HTTPS 请求超时 (${REQUEST_TIMEOUT}ms)`));
                });
                req.write(requestBody);
                req.end();
            });
        }

        console.log('[deepseek] 正在调用 DeepSeek API...');
        let raw = '';
        await new Promise((resolve, reject) => {
            upstreamRes.on('data', (chunk) => { raw += chunk; });
            upstreamRes.on('end', resolve);
            upstreamRes.on('error', reject);
        });

        const data = JSON.parse(raw || '{}');
        console.log('[deepseek] API 返回状态:', upstreamRes.statusCode);
        if (upstreamRes.statusCode !== 200) {
            console.log('[deepseek] API 错误:', data?.error?.message);
            return sendJson(res, upstreamRes.statusCode, {
                error: data?.error?.message || `DeepSeek API 返回 ${upstreamRes.statusCode}`
            });
        }

        const content = data?.choices?.[0]?.message?.content || '';
        console.log('[deepseek] 返回内容长度:', content.length);
        sendJson(res, 200, { content });
    } catch (error) {
        console.error('[deepseek] 错误:', error.message);
        sendJson(res, 500, { error: error.message || '代理请求失败' });
    }
}

// 注入 live-reload 客户端脚本到 HTML（仅本地开发）
const IS_DEV = process.env.NODE_ENV !== 'production';
const LIVE_RELOAD_SNIPPET = IS_DEV ? `
<script>
(function(){
  var es = new EventSource('/__livereload');
  es.onmessage = function(e){
    if(e.data === 'reload'){ location.reload(); }
  };
  es.onerror = function(){ es.close(); };
})();
</script>
` : '';

function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(ROOT, `.${requestedPath}`);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404);
            return res.end('Not Found');
        }

        const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';

        // 对 HTML 文件注入 live-reload 脚本
        if (contentType.startsWith('text/html')) {
            data = data.toString().replace('</body>', LIVE_RELOAD_SNIPPET + '</body>');
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store'
        });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/deepseek')) {
        handleDeepSeek(req, res);
        return;
    }

    if (req.url === '/__livereload') {
        handleSSE(req, res);
        return;
    }

    serveStatic(req, res);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 被占用，请先关闭占用该端口的进程，或设置 PORT 环境变量使用其他端口`);
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, () => {
    console.log(`Zcard running at http://localhost:${PORT}`);
});
