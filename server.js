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

function normalizeEnvUrl(value, key) {
    let normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    const prefix = `${key}=`;
    if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length).trim();
    }
    return normalized;
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

const PORT = Number(process.env.PORT || 8080);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const VIDEO_TEXT_API_URL = normalizeEnvUrl(process.env.VIDEO_TEXT_API_URL, 'VIDEO_TEXT_API_URL');
const VIDEO_TEXT_API_KEY = process.env.VIDEO_TEXT_API_KEY || '';
const VIDEO_TEXT_API_METHOD = (process.env.VIDEO_TEXT_API_METHOD || 'POST').trim().toUpperCase();
const VIDEO_TEXT_API_AUTH_HEADER = process.env.VIDEO_TEXT_API_AUTH_HEADER || 'Authorization';
const VIDEO_TEXT_API_AUTH_PREFIX = process.env.VIDEO_TEXT_API_AUTH_PREFIX || 'Bearer ';
const VIDEO_TEXT_API_URL_FIELD = process.env.VIDEO_TEXT_API_URL_FIELD || 'url';
const VIDEO_TEXT_API_QUERY_FIELD = process.env.VIDEO_TEXT_API_QUERY_FIELD || VIDEO_TEXT_API_URL_FIELD;
const VIDEO_TEXT_API_EXTRA_BODY = process.env.VIDEO_TEXT_API_EXTRA_BODY || '';
const VIDEO_TEXT_API_TIMEOUT_MS = Number(process.env.VIDEO_TEXT_API_TIMEOUT_MS || 30000);
const TIKHUB_API_KEY = process.env.TIKHUB_API_KEY || '';
const TIKHUB_API_BASE = (process.env.TIKHUB_API_BASE || 'https://api.tikhub.dev').replace(/\/+$/, '');
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const VIDEO_TEXT_API_TEXT_PATHS = (process.env.VIDEO_TEXT_API_TEXT_PATHS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const VIDEO_TEXT_API_TITLE_PATHS = (process.env.VIDEO_TEXT_API_TITLE_PATHS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const ROOT = __dirname;
const MIN_VIDEO_CONTENT_CHARS = 80;
const MIN_VIDEO_CONTENT_CJK_CHARS = 35;
const extractCache = new Map();

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

function countCjkChars(text) {
    const matches = String(text || '').match(/[\u4e00-\u9fff]/g);
    return matches ? matches.length : 0;
}

function hasEnoughVideoContent(text) {
    const content = String(text || '').trim();
    if (!content) return false;
    return content.length >= MIN_VIDEO_CONTENT_CHARS || countCjkChars(content) >= MIN_VIDEO_CONTENT_CJK_CHARS;
}

function extractLinks(text) {
    return String(text || '').match(/https?:\/\/[^\s]+/g) || [];
}

function cleanSharedText(text) {
    let cleaned = String(text || '');
    try {
        cleaned = decodeURIComponent(cleaned);
    } catch {
        // Shared links sometimes contain partial percent-encoding. Keep original text.
    }

    return cleaned
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/\{[^{}]*(schema_type|share_extra_params|social_share_user_id)[^{}]*\}/gi, '')
        .replace(/["{}[\]]/g, ' ')
        .replace(/\b(share_extra_params|schema_type|social_share_user_id|sec_uid|share_app_id)\b/gi, ' ')
        .replace(/[A-Za-z0-9_%=-]{18,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getByPath(value, pathExpression) {
    return pathExpression.split('.').reduce((current, key) => {
        if (current == null) return undefined;
        if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
        return current[key];
    }, value);
}

function stringifyCandidate(item) {
    if (!item) return '';
    if (Array.isArray(item)) {
        return item.map(stringifyCandidate).filter(Boolean).join('\n');
    }
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
        return item.text || item.content || item.subtitle || item.transcript || JSON.stringify(item);
    }
    return String(item);
}

function normalizeVideoTextPayload(payload) {
    const defaultTextCandidates = [
        payload?.transcript,
        payload?.subtitle,
        payload?.subtitles,
        payload?.text,
        payload?.content,
        payload?.description,
        payload?.data?.transcript,
        payload?.data?.subtitle,
        payload?.data?.subtitles,
        payload?.data?.text,
        payload?.data?.content,
        payload?.data?.description,
        payload?.result?.transcript,
        payload?.result?.subtitle,
        payload?.result?.subtitles,
        payload?.result?.text,
        payload?.result?.content,
        payload?.result?.description
    ];

    const configuredTextCandidates = VIDEO_TEXT_API_TEXT_PATHS.map((pathName) => getByPath(payload, pathName));
    const transcript = [...configuredTextCandidates, ...defaultTextCandidates]
        .filter(Boolean)
        .map(stringifyCandidate)
        .filter(Boolean)
        .join('\n')
        .trim();

    const configuredTitle = VIDEO_TEXT_API_TITLE_PATHS
        .map((pathName) => getByPath(payload, pathName))
        .find(Boolean);
    const title = configuredTitle || payload?.title || payload?.data?.title || payload?.result?.title || '';
    return { title: String(title || '').trim(), transcript };
}

function buildVideoTextRequestBody(videoLink) {
    let extraBody = {};
    if (VIDEO_TEXT_API_EXTRA_BODY) {
        try {
            extraBody = JSON.parse(VIDEO_TEXT_API_EXTRA_BODY);
        } catch {
            console.warn('[video-text] VIDEO_TEXT_API_EXTRA_BODY 不是有效 JSON，已忽略');
        }
    }
    return {
        ...extraBody,
        [VIDEO_TEXT_API_URL_FIELD]: videoLink
    };
}

function buildVideoTextQuery(videoLink) {
    let extraQuery = {};
    if (VIDEO_TEXT_API_EXTRA_BODY) {
        try {
            extraQuery = JSON.parse(VIDEO_TEXT_API_EXTRA_BODY);
        } catch {
            console.warn('[video-text] VIDEO_TEXT_API_EXTRA_BODY 不是有效 JSON，已忽略');
        }
    }
    return {
        ...extraQuery,
        [VIDEO_TEXT_API_QUERY_FIELD]: videoLink
    };
}

function buildVideoTextHeaders() {
    if (!VIDEO_TEXT_API_KEY) return {};
    return {
        [VIDEO_TEXT_API_AUTH_HEADER]: `${VIDEO_TEXT_API_AUTH_PREFIX}${VIDEO_TEXT_API_KEY}`
    };
}

function postJson(url, payload, headers = {}, timeoutMs = 30000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const body = JSON.stringify(payload);
        const lib = target.protocol === 'http:' ? http : https;
        const req = lib.request({
            hostname: target.hostname,
            port: target.port || (target.protocol === 'http:' ? 80 : 443),
            path: `${target.pathname}${target.search}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (upstreamRes) => {
            if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location && redirectCount < 3) {
                const nextTarget = new URL(upstreamRes.headers.location, target.href);
                if (!nextTarget.search && target.search) nextTarget.search = target.search;
                const nextUrl = nextTarget.href;
                upstreamRes.resume();
                const nextMethod = upstreamRes.statusCode === 303 ? getJson : postJson;
                nextMethod(nextUrl, payload, headers, timeoutMs, redirectCount + 1).then(resolve, reject);
                return;
            }

            let raw = '';
            upstreamRes.on('data', (chunk) => { raw += chunk; });
            upstreamRes.on('end', () => {
                let data = {};
                try {
                    data = JSON.parse(raw || '{}');
                } catch {
                    data = { raw };
                }
                resolve({ statusCode: upstreamRes.statusCode, data });
            });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`请求超时 (${timeoutMs}ms)`));
        });
        req.write(body);
        req.end();
    });
}

function getJson(url, query = {}, headers = {}, timeoutMs = 30000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        if (redirectCount === 0) {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    target.searchParams.set(key, String(value));
                }
            });
        }

        const lib = target.protocol === 'http:' ? http : https;
        const req = lib.request({
            hostname: target.hostname,
            port: target.port || (target.protocol === 'http:' ? 80 : 443),
            path: `${target.pathname}${target.search}`,
            method: 'GET',
            headers
        }, (upstreamRes) => {
            if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location && redirectCount < 3) {
                const nextTarget = new URL(upstreamRes.headers.location, target.href);
                if (!nextTarget.search && target.search) nextTarget.search = target.search;
                const nextUrl = nextTarget.href;
                upstreamRes.resume();
                getJson(nextUrl, {}, headers, timeoutMs, redirectCount + 1).then(resolve, reject);
                return;
            }

            let raw = '';
            upstreamRes.on('data', (chunk) => { raw += chunk; });
            upstreamRes.on('end', () => {
                let data = {};
                try {
                    data = JSON.parse(raw || '{}');
                } catch {
                    data = { raw };
                }
                resolve({ statusCode: upstreamRes.statusCode, data });
            });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`请求超时 (${timeoutMs}ms)`));
        });
        req.end();
    });
}

function buildCardPrompt(sourceText, videoLink = '') {
    const textLen = sourceText.length;
    let pointCount, pointLen, coreLen;

    if (textLen < 200) {
        pointCount = '2-3';
        pointLen = '50-100';
        coreLen = '50-100';
    } else if (textLen < 800) {
        pointCount = '3-5';
        pointLen = '80-150';
        coreLen = '80-150';
    } else {
        pointCount = '4-7';
        pointLen = '100-200';
        coreLen = '100-200';
    }

    return `你是一个专业的知识卡片整理助手。基于以下内容生成一张结构化的知识卡片。

要求：
- 只基于提供的内容总结，不要自行补充或推测
- ${pointCount}个key_points，每个要点要详细、有深度
- core_point 要概括核心观点，言之有物
- 如果内容中有金句或经典表达，提取到 quote 字段
- 如果内容中有可执行的建议，提取到 action 字段
- 根据内容自动判断领域分类

输出JSON格式：
{“title”:”8-16字标题”,”core_point”:”${coreLen}字核心观点”,”key_points”:[{“heading”:”4-12字小标题”,”content”:”${pointLen}字详细内容”}],”quote”:”金句（可选）”,”action”:”行动建议（可选）”,”category”:”领域分类”,”video_link”:”${videoLink}”}

内容：
${sourceText}`;
}

async function callDeepSeekJson(prompt, retryCount = 0) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('缺少 DEEPSEEK_API_KEY');
    }

    try {
        const result = await postJson('https://api.deepseek.com/chat/completions', {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            max_tokens: 2048,
            temperature: 0.3
        }, {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`
        }, 20000);

        if (result.statusCode !== 200) {
            throw new Error(result.data?.error?.message || `DeepSeek API 返回 ${result.statusCode}`);
        }

        const content = result.data?.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('AI 返回内容为空');
        return parseJsonObject(content);
    } catch (error) {
        if (retryCount < 1 && (error.message.includes('timeout') || error.message.includes('ECONNRESET') || error.message.includes('500'))) {
            console.log(`[deepseek] 重试第 ${retryCount + 1} 次...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return callDeepSeekJson(prompt, retryCount + 1);
        }
        throw error;
    }
}

function parseJsonObject(content) {
    const cleaned = String(content || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const candidates = [
        cleaned,
        start >= 0 && end > start ? cleaned.slice(start, end + 1) : '',
        cleaned.replace(/,\s*([}\]])/g, '$1')
    ].filter(Boolean);

    let lastError;
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('AI 返回 JSON 格式异常');
}

function createFallbackExtractedCard(sourceText, videoLink = '', meta = {}, errorMessage = '') {
    const text = String(sourceText || '').replace(/\s+/g, ' ').trim();
    const chunks = text
        .split(/[。！？!?；;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const first = chunks[0] || text || '这段内容值得整理成知识卡片';
    const title = String(meta.title || first).replace(/\s+/g, '').slice(0, 16) || '视频知识摘录';
    const core = chunks.slice(0, 2).join('。').slice(0, 140) || first.slice(0, 140);
    const headings = ['核心内容', '关键细节', '可复盘点', '后续理解'];
    const points = chunks.slice(1, 5);

    while (points.length < 4) {
        points.push([
            '保留视频中的主要事实与判断，方便后续不打开原视频也能快速回忆。',
            '把内容拆成可复盘的要点，后续可以继续编辑、标注和补充。',
            '当前卡片由本地保底逻辑生成，建议保存后再按自己的理解微调。',
            '如果需要更精细的总结，可以补充更完整字幕或稍后重新生成。'
        ][points.length]);
    }

    return {
        title,
        core_point: core,
        key_points: points.slice(0, 4).map((point, index) => ({
            heading: headings[index],
            content: point.length < 36 ? `${point}。这个信息可以作为之后复盘原视频的线索。` : point.slice(0, 180)
        })),
        quote: '',
        action: '',
        category: '默认',
        video_link: videoLink,
        is_local: true,
        fallback_reason: errorMessage
    };
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

async function fetchVideoText(videoLink) {
    console.log('[video-text] 开始提取, videoLink:', videoLink);
    console.log('[video-text] VIDEO_TEXT_API_URL:', VIDEO_TEXT_API_URL);
    console.log('[video-text] VIDEO_TEXT_API_METHOD:', VIDEO_TEXT_API_METHOD);

    if (!VIDEO_TEXT_API_URL) {
        console.log('[video-text] 未配置 VIDEO_TEXT_API_URL');
        return {
            status: 'needs_text',
            reason: '未配置 VIDEO_TEXT_API_URL，暂时无法只通过链接提取视频文字。'
        };
    }
    if (!isHttpUrl(VIDEO_TEXT_API_URL)) {
        console.log('[video-text] VIDEO_TEXT_API_URL 不是有效链接:', VIDEO_TEXT_API_URL);
        return {
            status: 'needs_text',
            reason: 'VIDEO_TEXT_API_URL 不是有效链接，请只填写 https://... 形式的接口地址，不要带变量名。'
        };
    }

    console.log('[video-text] 调用 API...');
    const result = VIDEO_TEXT_API_METHOD === 'GET'
        ? await getJson(VIDEO_TEXT_API_URL, buildVideoTextQuery(videoLink), buildVideoTextHeaders(), VIDEO_TEXT_API_TIMEOUT_MS)
        : await postJson(VIDEO_TEXT_API_URL, buildVideoTextRequestBody(videoLink), buildVideoTextHeaders(), VIDEO_TEXT_API_TIMEOUT_MS);

    console.log('[video-text] API 返回状态:', result.statusCode);
    console.log('[video-text] API 返回数据:', JSON.stringify(result.data).substring(0, 500));

    if (result.statusCode < 200 || result.statusCode >= 300) {
        console.log('[video-text] API 返回错误:', result.data?.error || result.data?.message);
        return {
            status: 'needs_text',
            reason: result.data?.error || result.data?.message || `视频文字提取 API 返回 ${result.statusCode}`
        };
    }

    const normalized = normalizeVideoTextPayload(result.data);
    console.log('[video-text] 解析后 title:', normalized.title);
    console.log('[video-text] 解析后 transcript 长度:', normalized.transcript.length);
    console.log('[video-text] 解析后 transcript 前200字:', normalized.transcript.substring(0, 200));

    if (!hasEnoughVideoContent(normalized.transcript)) {
        console.log('[video-text] 内容不够，需要用户手动输入');
        return {
            status: 'needs_text',
            reason: '视频文字提取 API 未返回足够的字幕或转录文本。',
            title: normalized.title,
            transcriptLength: normalized.transcript.length
        };
    }

    console.log('[video-text] 提取成功');
    return {
        status: 'ok',
        title: normalized.title,
        transcript: normalized.transcript
    };
}

async function fetchSubtitleText(subtitleUrl) {
    try {
        const result = await new Promise((resolve, reject) => {
            const target = new URL(subtitleUrl);
            const lib = target.protocol === 'http:' ? http : https;
            const req = lib.request({
                hostname: target.hostname,
                port: target.port,
                path: `${target.pathname}${target.search}`,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }, (upstreamRes) => {
                if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
                    upstreamRes.resume();
                    fetchSubtitleText(upstreamRes.headers.location).then(resolve).catch(reject);
                    return;
                }
                let raw = '';
                upstreamRes.on('data', (chunk) => { raw += chunk; });
                upstreamRes.on('end', () => resolve(raw));
            });
            req.on('error', reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error('字幕下载超时')); });
            req.end();
        });

        // 清理 SRT/VTT 格式，只保留文字
        return result
            .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
            .replace(/^\d+\s*$/gm, '')
            .replace(/WEBVTT\s*\n?/g, '')
            .replace(/\[Music\]|\[音乐\]/gi, '')
            .replace(/\n{2,}/g, '\n')
            .trim();
    } catch (e) {
        console.warn('[tikhub] 字幕下载失败:', e.message);
        return '';
    }
}

async function fetchVideoTextTikHub(videoLink) {
    if (!TIKHUB_API_KEY) {
        return { status: 'needs_text', reason: '未配置 TIKHUB_API_KEY' };
    }

    const url = `${TIKHUB_API_BASE}/api/v1/douyin/web/fetch_one_video_by_share_url`;
    console.log('[tikhub] 调用 TikHub API:', url);

    const result = await getJson(url, { share_url: videoLink }, {
        Authorization: `Bearer ${TIKHUB_API_KEY}`
    }, 15000);

    console.log('[tikhub] 返回状态:', result.statusCode);

    if (result.statusCode !== 200) {
        return { status: 'needs_text', reason: `TikHub API 返回 ${result.statusCode}` };
    }

    const detail = result.data?.data?.aweme_detail || result.data?.aweme_detail;
    if (!detail) {
        return { status: 'needs_text', reason: 'TikHub 未返回视频详情' };
    }

    // 获取视频下载链接（用于音频转录）
    const videoUrl = detail.video?.play_addr?.url_list?.[0]
        || detail.video?.play_addr_h264?.url_list?.[0]
        || detail.video?.download_addr?.url_list?.[0]
        || '';

    let transcript = '';

    // 优先用 subtitle_text（直接文本）
    if (detail.video?.subtitle_text) {
        transcript = detail.video.subtitle_text;
    }

    // 其次尝试下载字幕文件
    if (!hasEnoughVideoContent(transcript)) {
        const captionInfos = detail.video?.caption_infos || [];
        const captionUrl = captionInfos.find(c => c.subtitling_url || c.url);
        if (captionUrl) {
            const srtUrl = captionUrl.subtitling_url || captionUrl.url;
            console.log('[tikhub] 下载字幕:', srtUrl);
            transcript = await fetchSubtitleText(srtUrl);
        }
    }

    // 降级：用视频描述
    if (!hasEnoughVideoContent(transcript) && detail.desc) {
        transcript = detail.desc;
    }

    const title = detail.desc?.slice(0, 30) || detail.author?.nickname || '';

    if (!hasEnoughVideoContent(transcript)) {
        return { status: 'needs_text', reason: 'TikHub 未返回足够的字幕或描述文本', title, videoUrl };
    }

    console.log('[tikhub] 提取成功, 长度:', transcript.length);
    return { status: 'ok', title, transcript };
}

async function transcribeAudioWithGroq(videoUrl) {
    if (!GROQ_API_KEY) {
        console.log('[groq] 未配置 GROQ_API_KEY，跳过音频转录');
        return { status: 'needs_text', reason: '未配置 GROQ_API_KEY' };
    }

    console.log('[groq] 开始下载视频用于音频转录...');

    // 下载视频文件
    const videoBuffer = await new Promise((resolve, reject) => {
        const target = new URL(videoUrl);
        const lib = target.protocol === 'http:' ? http : https;
        const req = lib.request({
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }, (upstreamRes) => {
            if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
                upstreamRes.resume();
                transcribeAudioWithGroq(upstreamRes.headers.location).then(resolve).catch(reject);
                return;
            }
            const chunks = [];
            upstreamRes.on('data', (chunk) => chunks.push(chunk));
            upstreamRes.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('视频下载超时')); });
        req.end();
    });

    console.log('[groq] 视频下载完成，大小:', videoBuffer.length, 'bytes');

    // 构建 multipart/form-data 请求
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const model = 'whisper-large-v3-turbo';
    const parts = [];

    // file 字段
    parts.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="video.mp4"\r\n`,
        `Content-Type: video/mp4\r\n\r\n`
    );
    parts.push(videoBuffer);
    parts.push('\r\n');

    // model 字段
    parts.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="model"\r\n\r\n`,
        `${model}\r\n`
    );

    // language 字段
    parts.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="language"\r\n\r\n`,
        `zh\r\n`
    );

    // response_format 字段
    parts.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="response_format"\r\n\r\n`,
        `json\r\n`
    );

    parts.push(`--${boundary}--\r\n`);

    // 合并所有部分为 Buffer
    const bodyParts = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
    const body = Buffer.concat(bodyParts);

    console.log('[groq] 调用 Whisper API...');

    const result = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, (upstreamRes) => {
            let raw = '';
            upstreamRes.on('data', (chunk) => { raw += chunk; });
            upstreamRes.on('end', () => {
                try {
                    resolve({ statusCode: upstreamRes.statusCode, data: JSON.parse(raw || '{}') });
                } catch {
                    resolve({ statusCode: upstreamRes.statusCode, data: { raw } });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Groq API 超时')); });
        req.write(body);
        req.end();
    });

    console.log('[groq] Whisper 返回状态:', result.statusCode);

    if (result.statusCode !== 200) {
        console.log('[groq] 错误:', JSON.stringify(result.data).slice(0, 200));
        return { status: 'needs_text', reason: `Groq Whisper 返回 ${result.statusCode}` };
    }

    const transcript = result.data.text || '';
    console.log('[groq] 转录完成, 长度:', transcript.length);

    if (!hasEnoughVideoContent(transcript)) {
        return { status: 'needs_text', reason: '音频转录内容不足' };
    }

    return { status: 'ok', transcript };
}

async function handleExtractCard(req, res) {
    if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    try {
        const body = JSON.parse(await readBody(req));
        const input = String(body.input || body.text || body.url || '').trim();
        if (!input) {
            return sendJson(res, 400, { error: '缺少 input' });
        }

        const links = extractLinks(input);
        const videoLink = links[0] || '';
        const cleanedText = cleanSharedText(input);
        const cacheKey = videoLink || cleanedText;
        if (cacheKey && extractCache.has(cacheKey)) {
            return sendJson(res, 200, { ...extractCache.get(cacheKey), cached: true });
        }

        let sourceText = cleanedText;
        let sourceType = 'pasted_text';
        let extractMeta = {};

        if (videoLink) {
            // 优先使用 TikHub（抖音专用，速度快）
            if (TIKHUB_API_KEY) {
                const tikHubResult = await fetchVideoTextTikHub(videoLink);
                if (tikHubResult.status === 'ok') {
                    sourceText = tikHubResult.transcript;
                    sourceType = 'video_api';
                    extractMeta = { title: tikHubResult.title || '' };
                } else {
                    // TikHub 没拿到字幕，尝试音频转录（如果有视频链接）
                    if (tikHubResult.videoUrl && GROQ_API_KEY) {
                        console.log('[tikhub] 字幕不足，尝试音频转录...');
                        const whisperResult = await transcribeAudioWithGroq(tikHubResult.videoUrl);
                        if (whisperResult.status === 'ok') {
                            sourceText = whisperResult.transcript;
                            sourceType = 'video_api';
                            extractMeta = { title: tikHubResult.title || '' };
                        } else {
                            console.log('[groq] 音频转录失败:', whisperResult.reason);
                            // 音频转录也失败，降级到通用 API 或使用粘贴文案
                            if (VIDEO_TEXT_API_URL) {
                                const videoText = await fetchVideoText(videoLink);
                                if (videoText.status === 'ok') {
                                    sourceText = videoText.transcript;
                                    sourceType = 'video_api';
                                    extractMeta = { title: videoText.title || '' };
                                } else if (!hasEnoughVideoContent(sourceText)) {
                                    return sendJson(res, 200, {
                                        status: 'needs_text',
                                        video_link: videoLink,
                                        reason: videoText.reason || '暂时无法提取视频完整文字。',
                                        title: videoText.title || ''
                                    });
                                }
                            } else if (!hasEnoughVideoContent(sourceText)) {
                                return sendJson(res, 200, {
                                    status: 'needs_text',
                                    video_link: videoLink,
                                    reason: whisperResult.reason || '暂时无法提取视频完整文字。'
                                });
                            }
                        }
                    } else if (VIDEO_TEXT_API_URL) {
                        // 没有音频转录，降级到通用 API
                        const videoText = await fetchVideoText(videoLink);
                        if (videoText.status === 'ok') {
                            sourceText = videoText.transcript;
                            sourceType = 'video_api';
                            extractMeta = { title: videoText.title || '' };
                        } else if (!hasEnoughVideoContent(sourceText)) {
                            return sendJson(res, 200, {
                                status: 'needs_text',
                                video_link: videoLink,
                                reason: videoText.reason || '暂时无法提取视频完整文字。',
                                title: videoText.title || ''
                            });
                        }
                    } else if (!hasEnoughVideoContent(sourceText)) {
                        return sendJson(res, 200, {
                            status: 'needs_text',
                            video_link: videoLink,
                            reason: tikHubResult.reason || '暂时无法提取视频完整文字。'
                        });
                    }
                }
            } else if (VIDEO_TEXT_API_URL) {
                // 没有 TikHub，用通用 API
                const videoText = await fetchVideoText(videoLink);
                if (videoText.status === 'ok') {
                    sourceText = videoText.transcript;
                    sourceType = 'video_api';
                    extractMeta = { title: videoText.title || '' };
                } else if (!hasEnoughVideoContent(sourceText)) {
                    return sendJson(res, 200, {
                        status: 'needs_text',
                        video_link: videoLink,
                        reason: videoText.reason || '暂时无法提取视频完整文字。',
                        title: videoText.title || ''
                    });
                }
            } else if (!hasEnoughVideoContent(sourceText)) {
                return sendJson(res, 200, {
                    status: 'needs_text',
                    video_link: videoLink,
                    reason: '未配置视频提取 API，请配置 TIKHUB_API_KEY 或 VIDEO_TEXT_API_URL。'
                });
            }
        }

        if (!hasEnoughVideoContent(sourceText)) {
            return sendJson(res, 200, {
                status: 'needs_text',
                video_link: videoLink,
                reason: '输入内容太短，请粘贴视频字幕、转录文本或较完整的视频文案。'
            });
        }

        let card;
        try {
            card = await callDeepSeekJson(buildCardPrompt(sourceText, videoLink));
        } catch (error) {
            if (error.message === '缺少 DEEPSEEK_API_KEY') {
                return sendJson(res, 200, {
                    status: 'needs_ai_key',
                    source_type: sourceType,
                    source_text_length: sourceText.length,
                    video_link: videoLink,
                    reason: '已提取到视频文字，但缺少 DEEPSEEK_API_KEY，暂时无法生成 Zcard 卡片。'
                });
            }
            console.warn('[extract-card] AI 返回格式异常，已使用保底卡片:', error.message);
            card = createFallbackExtractedCard(sourceText, videoLink, extractMeta, error.message);
        }

        const response = {
            status: 'ok',
            source_type: sourceType,
            source_text_length: sourceText.length,
            video_link: card.video_link || videoLink,
            card: {
                ...card,
                video_link: card.video_link || videoLink,
                category: card.category || '默认',
                source_text: sourceText,
                source_meta: extractMeta
            }
        };

        if (cacheKey) extractCache.set(cacheKey, response);
        return sendJson(res, 200, response);
    } catch (error) {
        console.error('[extract-card] 错误:', error.message);
        return sendJson(res, 500, { error: error.message || '生成卡片失败' });
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
    if (req.url.startsWith('/api/extract-card')) {
        handleExtractCard(req, res);
        return;
    }

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
