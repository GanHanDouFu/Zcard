const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function handleDeepSeek(req, res) {
    if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    if (!DEEPSEEK_API_KEY) {
        return sendJson(res, 500, { error: '缺少 DEEPSEEK_API_KEY 环境变量' });
    }

    try {
        const { prompt } = JSON.parse(await readBody(req));
        if (!prompt || typeof prompt !== 'string') {
            return sendJson(res, 400, { error: '缺少 prompt' });
        }

        const upstream = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });

        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
            return sendJson(res, upstream.status, {
                error: data?.error?.message || `DeepSeek API 返回 ${upstream.status}`
            });
        }

        sendJson(res, 200, {
            content: data?.choices?.[0]?.message?.content || ''
        });
    } catch (error) {
        sendJson(res, 500, { error: error.message || '代理请求失败' });
    }
}

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
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store'
        });
        res.end(data);
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

server.listen(PORT, () => {
    console.log(`Zcard running at http://localhost:${PORT}`);
});
