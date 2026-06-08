/**
 * 抖音知识卡片 - 核心逻辑 (script.js)
 */

// 全局状态
let cards = [];
let currentCategory = '全部';
let currentSearch = '';
let currentView = 'home'; // home | unread | read | favorites | graph
let activeGraphCategory = '';
let activeGraphFilter = 'all';
const DEFAULT_CATEGORY = '默认';
const MERGED_CATEGORY = '整合';
let pendingIntegrateResult = null; // 整合预览暂存
let swipeReviewQueue = [];
let swipeReviewIndex = 0;
let swipeUnderstood = 0;
let swipeConfused = 0;
let selectedCards = new Set();
let flashcardQueue = [];
let currentFlashcardIndex = 0;
let currentActionCardId = null;
let currentReviewCardId = null;
let isEditingCard = false;
let reviewRevealTimer = null;
let activeEditField = 'core_point';
let precisionMarkState = null;
let precisionMarkDrag = null;
let pendingEditMarks = {};
let reviewCardFlipped = false;
let activeReviewIds = [];
let swipeReviewResults = {};
let quizQueue = [];
let quizIndex = 0;
let quizCorrect = 0;
let quizWrong = 0;
let quizLocked = false;
let currentQuizQuestion = null;
let quizTransitionTimer = null;

const REVIEW_SETTINGS_KEY = 'zcard_review_settings_v1';
const REVIEW_SESSION_KEY = 'zcard_review_session_v1';
const REVIEW_STATS_KEY = 'zcard_review_stats_v1';
const REVIEW_RING_GOAL = 7;
const QUIZ_FALLBACK_OPTIONS = [
    '强调先理解核心结论，再开始实践。',
    '重点不是做得更多，而是做得更有效。',
    '关键在于长期坚持，而不是短期冲刺。',
    '把复杂问题拆成小步骤，执行门槛会更低。',
    '先找到最重要的一点，再逐步扩展细节。',
    '与其被动接受信息，不如主动形成判断。'
];
const REQUIRED_DEMO_CARD_IDS = ['demo_huayi_downfall', 'demo_huayi_bankruptcy'];

// 检查 localStorage 是否可用
let storageAvailable = true;
try {
    localStorage.setItem('__test__', '1');
    localStorage.removeItem('__test__');
} catch (e) {
    storageAvailable = false;
    console.warn('[Zcard] localStorage 不可用，将使用内存存储');
}

// API 配置
const API_URL = 'https://api.deepseek.com/chat/completions';
const PROXY_API_URL = '/api/deepseek';
const EXTRACT_CARD_API_URL = '/api/extract-card';
let API_KEY = sessionStorage.getItem('deepseek_api_key') || '';
const MIN_VIDEO_CONTENT_CHARS = 80;
const MIN_VIDEO_CONTENT_CJK_CHARS = 35;
const TEXT_STYLE_DEFAULTS = {
    title: { fontSize: '16px', color: '#1f1f1d' },
    core_point: { fontSize: '16px', color: '#1f1f1d' },
    key_points: { fontSize: '16px', color: '#1f1f1d' },
    quote: { fontSize: '16px', color: '#6f6b65' },
    action: { fontSize: '16px', color: '#1f1f1d' },
    note: { fontSize: '16px', color: '#1f1f1d' }
};
cards = loadCards();

function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderInlineMarks(value) {
    return escapeHTML(value)
        .replace(/\[\[mark(?::?([a-z]+))?\]\]([\s\S]*?)\[\[\/mark\]\]/g, (match, color, text) => `<mark class="text-mark mark-${escapeHTML(color || 'red')}">${text}</mark>`);
}

function normalizeMarkRanges(ranges) {
    return Array.isArray(ranges)
        ? ranges
            .map((range) => ({
                start: Math.max(0, Number(range.start) || 0),
                end: Math.max(0, Number(range.end) || 0),
                color: ['red', 'yellow', 'green', 'blue'].includes(range.color) ? range.color : 'red'
            }))
            .filter((range) => range.end > range.start)
        : [];
}

function renderMarkedText(value, ranges = []) {
    const text = stripInlineMarks(value);
    const marks = normalizeMarkRanges(ranges).sort((a, b) => a.start - b.start);
    let cursor = 0;
    let html = '';
    marks.forEach((range) => {
        const start = Math.max(cursor, Math.min(range.start, text.length));
        const end = Math.max(start, Math.min(range.end, text.length));
        if (start > cursor) html += escapeHTML(text.slice(cursor, start));
        if (end > start) {
            html += `<mark class="text-mark mark-${escapeHTML(range.color)}">${escapeHTML(text.slice(start, end))}</mark>`;
        }
        cursor = end;
    });
    html += escapeHTML(text.slice(cursor));
    return html;
}

function renderMarkedField(card, field, fallback = '') {
    return renderMarkedText(card?.[field] || fallback, card?.marks?.[field] || []);
}

function renderEditableHtml(value, ranges = []) {
    return renderMarkedText(value, ranges).replace(/\n/g, '<br>');
}

function getEditablePlainText(element) {
    if (!element) return '';
    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeName === 'BR') return '\n';
        let text = '';
        node.childNodes.forEach((child) => {
            text += walk(child);
        });
        if (node.nodeType === Node.ELEMENT_NODE && ['DIV', 'P'].includes(node.nodeName) && text && !text.endsWith('\n')) {
            text += '\n';
        }
        return text;
    };
    return walk(element).replace(/\n$/, '');
}

function getEditableMarkRanges(element) {
    if (!element) return [];
    const ranges = [];
    let offset = 0;
    const walk = (node, activeColor = '') => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue || '';
            if (activeColor && text.length) {
                ranges.push({ start: offset, end: offset + text.length, color: activeColor });
            }
            offset += text.length;
            return;
        }
        if (node.nodeName === 'BR') {
            offset += 1;
            return;
        }
        const elementNode = node.nodeType === Node.ELEMENT_NODE ? node : null;
        const colorClass = elementNode ? [...elementNode.classList].find((name) => name.startsWith('mark-')) : '';
        const nextColor = colorClass ? colorClass.replace('mark-', '') : activeColor;
        node.childNodes.forEach((child) => walk(child, nextColor));
        if (elementNode && ['DIV', 'P'].includes(elementNode.nodeName)) {
            offset += 1;
        }
    };
    element.childNodes.forEach((child) => walk(child));
    return normalizeMarkRanges(ranges);
}

function getSelectionOffsetsWithin(element) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
    const beforeStart = document.createRange();
    beforeStart.selectNodeContents(element);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = document.createRange();
    beforeEnd.selectNodeContents(element);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return {
        start: beforeStart.toString().length,
        end: beforeEnd.toString().length,
        collapsed: range.collapsed
    };
}

function getSelectionRectWithin(element) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    return rects[0] || range.getBoundingClientRect();
}

function rerenderEditableField(element, keepStart = null, keepEnd = null) {
    if (!element) return;
    const field = element.dataset.styleField;
    element.innerHTML = renderEditableHtml(getEditablePlainText(element), pendingEditMarks[field] || []);
    if (typeof keepStart === 'number' && typeof keepEnd === 'number') {
        setEditableSelection(element, keepStart, keepEnd);
    }
}

function setEditableSelection(element, start, end) {
    const selection = window.getSelection();
    if (!selection) return;
    let offset = 0;
    let startPoint = null;
    let endPoint = null;
    const walk = (node) => {
        if (startPoint && endPoint) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const length = node.nodeValue.length;
            if (!startPoint && start <= offset + length) {
                startPoint = { node, offset: Math.max(0, start - offset) };
            }
            if (!endPoint && end <= offset + length) {
                endPoint = { node, offset: Math.max(0, end - offset) };
            }
            offset += length;
            return;
        }
        if (node.nodeName === 'BR') {
            offset += 1;
            return;
        }
        node.childNodes.forEach(walk);
    };
    walk(element);
    if (!startPoint || !endPoint) return;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    selection.removeAllRanges();
    selection.addRange(range);
}

function renderMultilineText(value) {
    return renderInlineMarks(value).replace(/\n/g, '<br>');
}

function stripInlineMarks(value) {
    return String(value || '').replace(/\[\[mark(?::?[a-z]+)?\]\]|\[\[\/mark\]\]/g, '');
}

function safeList(items) {
    return Array.isArray(items) ? items : [];
}

function isGenericPointHeading(value) {
    return /^要点\s*\d+$/i.test(String(value || '').trim());
}

function cleanPointHeading(value, index = 0) {
    let heading = String(value || '').trim();
    heading = heading.replace(/^(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]|要点\s*\d+[：:、.．]?)\s*/, '').trim();
    heading = heading.split(/[：:。；;，,]/)[0].trim();
    heading = heading
        .replace(/的区分$/, '')
        .replace(/的维护$/, '')
        .replace(/方法$/, '')
        .replace(/价值$/, '')
        .trim();
    return heading.slice(0, 12) || `要点${index + 1}`;
}

function derivePointParts(value, index = 0) {
    const text = String(value || '').trim();
    const stripped = text.replace(/^(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]|要点\s*\d+[：:、.．]?)\s*/, '').trim();
    const colon = stripped.match(/^([^：:。；;]{2,18})[：:]\s*(.+)$/);
    if (colon) {
        return {
            heading: cleanPointHeading(colon[1], index),
            content: colon[2].trim()
        };
    }
    const sentence = stripped.split(/[。；;，,]/).find(Boolean) || '';
    return {
        heading: cleanPointHeading(sentence, index),
        content: stripped
    };
}

function pointHeading(point, index) {
    if (point && typeof point === 'object') {
        const heading = stripInlineMarks(point.heading || point.title || '').trim();
        const contentParts = derivePointParts(point.content || point.detail || point.description || point.text || '', index);
        if (heading && !isGenericPointHeading(heading)) {
            return cleanPointHeading(heading, index) || contentParts.heading;
        }
        return contentParts.heading;
    }
    return derivePointParts(point, index).heading;
}

function pointContent(point, index = 0) {
    if (point && typeof point === 'object') {
        const content = String(point.content || point.detail || point.description || point.text || '').trim();
        let cleanContent = derivePointParts(content, index).content;
        const heading = String(point.heading || point.title || '').trim();
        const displayHeading = cleanPointHeading(heading, index);
        [heading, displayHeading].filter(Boolean).forEach((candidate) => {
            if (cleanContent.startsWith(`${candidate}：`) || cleanContent.startsWith(`${candidate}:`)) {
                cleanContent = cleanContent.slice(candidate.length + 1).trim();
            }
        });
        const colonParts = cleanContent.match(/^([^：:。；;]{2,18})[：:]\s*(.+)$/);
        if (colonParts && cleanPointHeading(colonParts[1], index) === displayHeading) {
            cleanContent = colonParts[2].trim();
        }
        return cleanContent;
    }
    return derivePointParts(point, index).content;
}

function pointContentWithMarks(point, index = 0) {
    if (point && typeof point === 'object') {
        return pointContent(point, index);
    }
    const text = String(point || '').trim();
    const stripped = text.replace(/^(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]|要点\s*\d+[：:、.．]?)\s*/, '').trim();
    const colon = stripped.match(/^([^：:。；;]{2,18})[：:]\s*(.+)$/);
    return colon ? colon[2].trim() : stripped;
}

function pointPlainText(point, index = 0) {
    const heading = pointHeading(point, index);
    const content = pointContent(point, index);
    return heading && content && !content.startsWith(heading)
        ? `${heading}：${content}`
        : (content || heading);
}

function normalizeKeyPoint(point, index = 0) {
    return {
        heading: pointHeading(point, index),
        content: pointContent(point, index)
    };
}

function isLocalAppUrl(value) {
    try {
        const url = new URL(String(value || '').trim(), window.location.href);
        return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
    } catch {
        return false;
    }
}

function sourceVideoUrl(value) {
    const url = safeUrl(value);
    return url && !isLocalAppUrl(url) ? url : '';
}

function renderSourceLink(card) {
    const links = [
        sourceVideoUrl(card.video_link),
        ...safeList(card.source_links).map(sourceVideoUrl)
    ].filter(Boolean);
    const uniqueLinks = [...new Set(links)];
    if (!uniqueLinks.length) return '';
    return `
        <div class="detail-section source-link-section">
            <h4>${uniqueLinks.length > 1 ? '原视频链接' : '原视频链接'}</h4>
            ${uniqueLinks.map((sourceUrl, index) => `
                <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">${uniqueLinks.length > 1 ? `来源${index + 1}：` : ''}${escapeHTML(sourceUrl)}</a>
            `).join('')}
        </div>
    `;
}

function getAdjustedMarksForSegment(ranges, segmentStart, segmentText) {
    const segmentEnd = segmentStart + segmentText.length;
    return normalizeMarkRanges(ranges)
        .map((range) => ({
            start: Math.max(range.start, segmentStart) - segmentStart,
            end: Math.min(range.end, segmentEnd) - segmentStart,
            color: range.color
        }))
        .filter((range) => range.end > range.start);
}

function renderDetailPoints(points, fieldMarks = []) {
    const list = safeList(points);
    if (!list.length) return '';
    let offset = 0;
    return `
        <div class="detail-point-list">
            ${list.map((point, index) => {
                const lineText = pointPlainText(point, index);
                const contentText = pointContentWithMarks(point, index);
                const contentOffset = Math.max(0, lineText.indexOf(contentText));
                const contentMarks = getAdjustedMarksForSegment(fieldMarks, offset + contentOffset, contentText);
                offset += lineText.length + 1;
                return `
                    <section class="detail-point-item ${index === 0 ? 'is-open' : ''}">
                        <button class="detail-point-heading" type="button" data-point-toggle aria-expanded="${index === 0 ? 'true' : 'false'}">
                            <span>${['一', '二', '三', '四', '五'][index] || index + 1}</span>
                            <strong>${escapeHTML(pointHeading(point, index))}</strong>
                            <i data-lucide="chevron-down"></i>
                        </button>
                        <div class="detail-point-content">
                            <p>${renderMarkedText(contentText, contentMarks)}</p>
                        </div>
                    </section>
                `;
            }).join('')}
        </div>
    `;
}

function safeUrl(value) {
    try {
        const url = new URL(String(value || '').trim(), window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function normalizeCard(card) {
    if (!card.customStyles || typeof card.customStyles !== 'object') {
        card.customStyles = {};
    }
    if (!card.marks || typeof card.marks !== 'object') {
        card.marks = {};
    }
    ['title', 'core_point', 'key_points', 'note'].forEach((field) => {
        card.marks[field] = normalizeMarkRanges(card.marks[field]);
    });
    Object.keys(TEXT_STYLE_DEFAULTS).forEach((key) => {
        card.customStyles[key] = {
            ...TEXT_STYLE_DEFAULTS[key],
            ...(card.customStyles[key] || {})
        };
    });
    if (typeof card.isRead !== 'boolean') {
        card.isRead = !!card.isGot;
    }
    if (typeof card.isFavorite !== 'boolean') {
        card.isFavorite = false;
    }
    card.isDemo = typeof card.isDemo === 'boolean' ? card.isDemo : !!card.is_demo;
    card.is_demo = card.isDemo;
    card.isIntegrated = typeof card.isIntegrated === 'boolean' ? card.isIntegrated : !!card.is_integrated;
    card.is_integrated = card.isIntegrated;
    if (card.isIntegrated || card.is_integrated) {
        card.category = MERGED_CATEGORY;
    }
    if (!Array.isArray(card.sourceCards)) {
        card.sourceCards = Array.isArray(card.source_cards) ? [...card.source_cards] : [];
    }
    card.source_cards = [...card.sourceCards];
    if (!card.core_point && card.summary) {
        card.core_point = card.summary;
    }
    if (!Array.isArray(card.key_points) || card.key_points.length === 0) {
        card.key_points = safeList(card.angles);
    }
    if (!card.summary && card.core_point) {
        card.summary = card.core_point;
    }
    card.category = normalizeCategory(card.category);
    return card;
}

function buildRequiredDemoCards() {
    const today = new Date().toISOString().split('T')[0];
    return [
        {
            id: 'demo_huayi_downfall',
            title: '华谊兄弟败局',
            core_point: '华谊兄弟因战略失误、管理混乱和过度扩张导致资本局失败。',
            key_points: [
                '盲目投资和过度扩张，忽视主营业务',
                '内部管理混乱，缺乏有效监督',
                '对市场变化反应迟钝，错失转型机会'
            ],
            quote: '这些坑踩得太致命。',
            action: '企业应聚焦核心业务，加强风险管控，及时调整战略。',
            category: '财经',
            video_link: '',
            created_at: today,
            is_todo: false,
            is_integrated: false,
            isRead: false,
            readAt: '',
            isFavorite: false,
            isDemo: true,
            isIntegrated: false,
            sourceCards: [],
            customStyles: {}
        },
        {
            id: 'demo_huayi_bankruptcy',
            title: '华谊兄弟破产',
            core_point: '华谊兄弟7年亏损82亿，被正式申请破产。',
            key_points: [
                '华谊兄弟7年累计亏损82亿元',
                '已被正式申请破产',
                '反映影视行业寒冬'
            ],
            quote: '7年亏了82亿元',
            action: '关注影视行业风险',
            category: '财经',
            video_link: '',
            created_at: today,
            is_todo: false,
            is_integrated: false,
            isRead: false,
            readAt: '',
            isFavorite: false,
            isDemo: true,
            isIntegrated: false,
            sourceCards: [],
            customStyles: {}
        }
    ].map(normalizeCard);
}

function styleAttr(card, field) {
    const styles = normalizeCard(card).customStyles[field] || TEXT_STYLE_DEFAULTS[field];
    return `style="font-size:${escapeHTML(styles.fontSize)};color:${escapeHTML(styles.color)};font-weight:${escapeHTML(styles.fontWeight || '400')};font-style:${escapeHTML(styles.fontStyle || 'normal')};text-decoration:${escapeHTML(styles.textDecoration || 'none')}"`;
}

function normalizeCategory(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_CATEGORY;
    if (raw === '全部' || raw === '未分类') return DEFAULT_CATEGORY;
    if (raw === '合并') return MERGED_CATEGORY;
    return raw.slice(0, 16);
}

function loadStoredJson(key, fallback) {
    if (!storageAvailable) return fallback;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`[Zcard] 读取 ${key} 失败，已回退默认值`, error);
        return fallback;
    }
}

function saveStoredJson(key, value) {
    if (!storageAvailable) return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`[Zcard] 保存 ${key} 失败`, error);
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || min));
}

function shuffleArray(list) {
    const next = [...list];
    for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
}

function loadReviewSettings() {
    return {
        cardCount: 4
    };
}

function saveReviewSettings() {
    saveStoredJson(REVIEW_SETTINGS_KEY, dailyReviewSettings);
}

function normalizeReviewSession(session) {
    return {
        date: String(session?.date || ''),
        cardIds: Array.isArray(session?.cardIds) ? session.cardIds : [],
        skippedIds: Array.isArray(session?.skippedIds) ? session.skippedIds : [],
        completed: !!session?.completed,
        completedAt: String(session?.completedAt || ''),
        correctCount: Number(session?.correctCount) || 0,
        wrongCount: Number(session?.wrongCount) || 0
    };
}

function loadReviewSession() {
    return normalizeReviewSession(loadStoredJson(REVIEW_SESSION_KEY, {}));
}

function saveReviewSession(session) {
    saveStoredJson(REVIEW_SESSION_KEY, normalizeReviewSession(session));
}

function loadReviewStats() {
    const stored = loadStoredJson(REVIEW_STATS_KEY, {});
    return {
        streakDays: Math.max(0, Number(stored.streakDays) || 0),
        lastCheckInDate: String(stored.lastCheckInDate || ''),
        knowledgePower: Math.max(0, Number(stored.knowledgePower) || 0),
        totalSessions: Math.max(0, Number(stored.totalSessions) || 0)
    };
}

function saveReviewStats(stats) {
    saveStoredJson(REVIEW_STATS_KEY, stats);
}

let dailyReviewSettings = loadReviewSettings();
let reviewSession = loadReviewSession();

function loadCards() {
    if (!storageAvailable) {
        console.log('[Zcard] 使用内存存储（localStorage 不可用）');
        return [];
    }
    try {
        const parsed = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
        return Array.isArray(parsed) ? parsed.map(normalizeCard) : [];
    } catch (error) {
        console.warn('本地卡片数据损坏，已重置为空列表。', error);
        localStorage.removeItem('douyin_cards');
        return [];
    }
}

// DOM 元素库 (延迟加载)
const els = {};

// 当前操作的卡片 ID
let currentViewCardId = null;

// 初始化
function init() {
    console.log('[Zcard] init 开始');
    
    // 延迟获取 DOM 元素
    els.videoInput = document.getElementById('video-input');
    els.btnGenerate = document.getElementById('btn-generate');
    els.loadingIndicator = document.getElementById('loading-indicator');
    els.toolbar = document.querySelector('.toolbar');
    els.cardsContainer = document.getElementById('cards-container');
    els.emptyState = document.getElementById('empty-state');
    els.categoryList = document.getElementById('category-list');
    els.searchInput = document.getElementById('search-input');
    els.batchActions = document.getElementById('batch-actions');
    els.selectedNum = document.getElementById('selected-num');
    els.btnIntegrate = document.getElementById('btn-integrate');
    els.btnExport = document.getElementById('btn-export');
    els.btnCancelSelect = document.getElementById('btn-cancel-select');
    els.reviewSection = document.getElementById('review-section');
    els.reviewHeading = document.getElementById('review-heading');
    els.reviewSubtext = document.getElementById('review-subtext');
    els.reviewStack = document.getElementById('review-stack');
    els.reviewCard = document.getElementById('review-card');
    els.reviewMetaText = document.getElementById('review-meta-text');
    els.reviewTitle = document.getElementById('review-title');
    els.reviewCore = document.getElementById('review-core');
    els.reviewHint = document.getElementById('review-hint');
    els.reviewBackMeta = document.getElementById('review-back-meta');
    els.reviewBackTitle = document.getElementById('review-back-title');
    els.reviewBackCore = document.getElementById('review-back-core');
    els.btnReviewDo = document.getElementById('btn-review-do');
    els.btnReviewSkip = document.getElementById('btn-review-skip');
    els.reviewCountPicker = document.getElementById('review-count-picker');
    els.reviewQueueLabel = document.getElementById('review-queue-label');
    els.reviewPowerTotal = document.getElementById('review-power-total');
    els.reviewStreakRing = document.getElementById('review-streak-ring');
    els.reviewStreakDays = document.getElementById('review-streak-days');
    els.reviewStreakLabel = document.getElementById('review-streak-label');
    els.reviewStreakButton = document.getElementById('review-streak-button');
    els.reviewMainEntryText = document.getElementById('review-main-entry-text');
    els.btnClearSearch = document.getElementById('btn-clear-search');
    els.searchModal = document.getElementById('search-modal');
    els.btnCloseSearch = document.getElementById('btn-close-search');
    els.searchResults = document.getElementById('search-results');
    els.searchResultTitle = document.getElementById('search-result-title');
    els.searchResultCount = document.getElementById('search-result-count');
    els.actionModal = document.getElementById('action-modal');
    els.btnActionDetail = document.getElementById('btn-action-detail');
    els.btnActionDouyin = document.getElementById('btn-action-douyin');
    els.btnActionCancel = document.getElementById('btn-action-cancel');
    els.cardModal = document.getElementById('card-modal');
    els.modalBody = document.getElementById('modal-card-body');
    els.btnCloseModal = document.getElementById('btn-close-modal');
    els.btnDeleteCard = document.getElementById('btn-delete-card');
    els.btnAddTodo = document.getElementById('btn-add-todo');
    els.btnEditCard = document.getElementById('btn-edit-card');
    els.btnSaveCard = document.getElementById('btn-save-card');
    els.btnCancelEdit = document.getElementById('btn-cancel-edit');
    els.notebookModal = document.getElementById('notebook-modal');
    els.btnCloseNotebook = document.getElementById('btn-close-notebook');
    els.notebookInput = document.getElementById('notebook-input');
    els.btnSaveNotebook = document.getElementById('btn-save-notebook');
    els.flashcardModal = document.getElementById('flashcard-modal');
    els.btnFlashcard = document.getElementById('btn-flashcard');
    els.btnCloseFlashcard = document.getElementById('btn-close-flashcard');
    els.flashcardElement = document.getElementById('flashcard-element');
    els.fcActions = document.getElementById('flashcard-actions');
    els.fcTitle = document.getElementById('fc-title');
    els.fcCore = document.getElementById('fc-core');
    els.fcPoints = document.getElementById('fc-points');
    els.fcCategory = document.getElementById('fc-category');
    els.fcProgress = document.getElementById('flashcard-progress');
    els.btnFcForget = document.getElementById('btn-fc-forget');
    els.btnFcRemember = document.getElementById('btn-fc-remember');
    els.settingsModal = document.getElementById('settings-modal');
    els.btnSettings = document.getElementById('btn-settings');
    els.btnCloseSettings = document.getElementById('btn-close-settings');
    els.apiKeyInput = document.getElementById('api-key-input');
    els.btnSaveSettings = document.getElementById('btn-save-settings');
    els.reviewStatsModal = document.getElementById('review-stats-modal');
    els.btnCloseReviewStats = document.getElementById('btn-close-review-stats');
    els.reviewStatsStreak = document.getElementById('review-stats-streak');
    els.reviewStatsTotal = document.getElementById('review-stats-total');
    els.reviewStatsPower = document.getElementById('review-stats-power');
    els.reviewStatsStatus = document.getElementById('review-stats-status');
    els.integratePreviewModal = document.getElementById('integrate-preview-modal');
    els.btnCloseIntegratePreview = document.getElementById('btn-close-integrate-preview');
    els.integratePreviewTitle = document.getElementById('integrate-preview-title');
    els.integratePreviewBody = document.getElementById('integrate-preview-body');
    els.btnCancelIntegrate = document.getElementById('btn-cancel-integrate');
    els.btnConfirmIntegrate = document.getElementById('btn-confirm-integrate');
    els.knowledgeGraphSection = document.getElementById('knowledge-graph-section');
    els.knowledgeUniverse = document.getElementById('knowledge-universe');
    els.knowledgeGraphCards = document.getElementById('knowledge-graph-cards');
    els.swipeModal = document.getElementById('swipe-review-modal');
    els.btnCloseSwipeReview = document.getElementById('btn-close-swipe-review');
    els.swipeHead = document.querySelector('.swipe-head');
    els.swipeScene = document.getElementById('swipe-review-scene');
    els.swipeCard = document.getElementById('swipe-review-card');
    els.swipeProgress = document.getElementById('swipe-review-progress');
    els.swipeArrowLeft = document.getElementById('swipe-arrow-left');
    els.swipeArrowRight = document.getElementById('swipe-arrow-right');
    els.swipeActionsBar = document.getElementById('swipe-actions-bar');
    els.swipeGestureHint = document.getElementById('swipe-gesture-hint');
    els.btnSwipeUnderstood = document.getElementById('btn-swipe-understood');
    els.btnSwipeConfused = document.getElementById('btn-swipe-confused');
    els.swipeDone = document.getElementById('swipe-done');
    els.swipeStatUnderstood = document.getElementById('swipe-stat-understood');
    els.swipeStatConfused = document.getElementById('swipe-stat-confused');
    els.btnSwipeDoneClose = document.getElementById('btn-swipe-done-close');
    els.quizStage = document.getElementById('quiz-stage');
    els.quizCardTitle = document.getElementById('quiz-card-title');
    els.quizProgress = document.getElementById('quiz-progress');
    els.quizQuestion = document.getElementById('quiz-question');
    els.quizOptions = document.getElementById('quiz-options');
    els.quizFeedback = document.getElementById('quiz-feedback');
    els.quizStreakText = document.getElementById('quiz-streak-text');
    els.quizScoreText = document.getElementById('quiz-score-text');
    els.quizConfettiLayer = document.getElementById('quiz-confetti-layer');
    els.quizPowerFloat = document.getElementById('quiz-power-float');
    els.quizComplete = document.getElementById('quiz-complete');
    els.quizCompleteTitle = document.getElementById('quiz-complete-title');
    els.quizCompleteCopy = document.getElementById('quiz-complete-copy');
    els.quizCompleteCorrect = document.getElementById('quiz-complete-correct');
    els.quizCompleteWrong = document.getElementById('quiz-complete-wrong');
    els.quizCompleteStreak = document.getElementById('quiz-complete-streak');
    els.btnQuizCompleteClose = document.getElementById('btn-quiz-complete-close');
    els.srCategory = document.getElementById('sr-category');
    els.srTitle = document.getElementById('sr-title');
    els.srCore = document.getElementById('sr-core');
    els.srPoints = document.getElementById('sr-points');

    initDemoCards();  // 先初始化演示卡片
    renderCategoryNav();
    renderCards();    // 再渲染
    refreshIcons();   // 初始化 Lucide 图标
    renderDailyReview();
    bindEvents();
    console.log('[Zcard] init 完成, cards 数量:', cards.length);
    console.log('[Zcard] cardsContainer innerHTML 长度:', els.cardsContainer.innerHTML.length);
    console.log('[Zcard] cardsContainer children:', els.cardsContainer.children.length);
}

// 首次访问生成演示卡片
function initDemoCards() {
    const requiredDemoCards = buildRequiredDemoCards();
    const existingIds = new Set(cards.map((card) => card.id));
    const missingDemoCards = requiredDemoCards.filter((card) => !existingIds.has(card.id));
    if (!missingDemoCards.length) return;

    cards = [...missingDemoCards, ...cards].map(normalizeCard);
    saveCards();
}

function getUserCategories() {
    const categories = new Set();
    cards.forEach((card) => {
        normalizeCard(card);
        const category = normalizeCategory(card.category);
        if (category) categories.add(category);
    });
    const sorted = [...categories]
        .filter((category) => category !== DEFAULT_CATEGORY && category !== MERGED_CATEGORY)
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    if (categories.has(DEFAULT_CATEGORY) || sorted.length === 0) {
        sorted.unshift(DEFAULT_CATEGORY);
    }
    if (cards.some((card) => normalizeCard(card).isIntegrated || card.is_integrated)) {
        sorted.unshift(MERGED_CATEGORY);
    }
    return sorted;
}

function updateCategorySearchPlaceholder() {
    if (!els.searchInput) return;
    els.searchInput.placeholder = `在【${currentCategory}】中搜索...`;
}

function renderCategoryNav() {
    if (!els.categoryList) return;
    const categories = getUserCategories();
    const validCategories = new Set(['全部', ...categories]);
    if (!validCategories.has(currentCategory)) {
        currentCategory = '全部';
    }

    const buttonHtml = ['全部', ...categories].map((category) => {
        const canDelete = category !== '全部' && category !== DEFAULT_CATEGORY && category !== MERGED_CATEGORY;
        const count = category === '全部'
            ? cards.length
            : (category === MERGED_CATEGORY
                ? cards.filter((card) => normalizeCard(card).isIntegrated || card.is_integrated).length
                : cards.filter((card) => normalizeCategory(card.category) === category).length);
        return `
            <button class="category-tag ${category === currentCategory ? 'active' : ''}" data-category="${escapeHTML(category)}" type="button">
                <span>${escapeHTML(category)}</span>
                <span class="category-count">${count}</span>
                ${canDelete ? `<span class="category-delete" data-delete-category="${escapeHTML(category)}" title="删除分类" aria-label="删除${escapeHTML(category)}分类">×</span>` : ''}
            </button>
        `;
    }).join('');

    els.categoryList.innerHTML = buttonHtml;
    updateCategorySearchPlaceholder();
    refreshIcons();
}

function setCurrentCategory(category) {
    currentCategory = category === '全部' ? '全部' : normalizeCategory(category);
    renderCategoryNav();
    renderCards();
}

function deleteCategory(category) {
    const normalized = normalizeCategory(category);
    if (!normalized || normalized === DEFAULT_CATEGORY || normalized === MERGED_CATEGORY) return;
    const count = cards.filter((card) => normalizeCategory(card.category) === normalized).length;
    if (!confirm(`删除“${normalized}”分类吗？该分类下 ${count} 张卡片会移到“默认”。`)) return;
    cards.forEach((card) => {
        if (normalizeCategory(card.category) === normalized) {
            card.category = DEFAULT_CATEGORY;
        }
    });
    if (currentCategory === normalized) {
        currentCategory = DEFAULT_CATEGORY;
    }
    saveCards();
    renderCategoryNav();
    renderCards();
}

function promptForCardCategory(card) {
    const existing = getUserCategories().filter((category) => category !== DEFAULT_CATEGORY);
    const preferred = currentCategory !== '全部' && currentCategory !== DEFAULT_CATEGORY
        ? currentCategory
        : (normalizeCategory(card.category) !== DEFAULT_CATEGORY ? normalizeCategory(card.category) : '');
    const message = [
        '给这张卡片输入分类名称：',
        existing.length ? `已有分类：${existing.join('、')}` : '还没有自定义分类，输入一个新分类即可创建。',
        '留空保存到“默认”，点取消则不加入已读。'
    ].join('\n');
    const value = window.prompt(message, preferred);
    if (value === null) return null;
    return normalizeCategory(value);
}

function getKnowledgeGraphGroups() {
    const groups = new Map();
    cards.forEach((rawCard) => {
        const card = normalizeCard(rawCard);
        const category = normalizeCategory(card.category);
        const bucket = groups.get(category) || [];
        bucket.push(card);
        groups.set(category, bucket);
    });

    const orderedCategories = getUserCategories();
    return orderedCategories
        .map((category, index) => ({
            category,
            cards: (groups.get(category) || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        }))
        .filter((group) => group.cards.length > 0);
}

// 分类徽标映射
const CATEGORY_MARKS = {
    [MERGED_CATEGORY]: '整',
    [DEFAULT_CATEGORY]: '知',
    '学习': '学',
    '职场': '职',
    '科技': '科',
    '生活': '生',
    '财经': '财',
    '健康': '康',
    '娱乐': '娱'
};

// 分类颜色映射（超低饱和浅色）
const CATEGORY_COLORS = {
    [MERGED_CATEGORY]: '#ECE8E1',
    [DEFAULT_CATEGORY]: '#F3F0EA',
    '学习': '#EEE9F7',
    '职场': '#E8EEF5',
    '生活': '#F4E7DD',
    '科技': '#F6ECCF',
    '健康': '#F6E5E1',
    '娱乐': '#EFE8F1',
    '财经': '#E5EFE9'
};

const CATEGORY_FALLBACK_COLORS = [
    '#EEE9F7',
    '#E8EEF5',
    '#E5EFE9',
    '#F6ECCF',
    '#F4E7DD',
    '#F6E5E1',
    '#EFE8F1',
    '#E9EEE6',
    '#F0EAE2',
    '#E7EFF0'
];

function getCategoryMark(category) {
    return CATEGORY_MARKS[category] || String(category || DEFAULT_CATEGORY).trim().slice(0, 1) || '知';
}

function getCategoryColor(category) {
    if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
    const seed = String(category || DEFAULT_CATEGORY)
        .split('')
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return CATEGORY_FALLBACK_COLORS[seed % CATEGORY_FALLBACK_COLORS.length];
}

function renderCategorySketchIcon(category, index = 0) {
    const rotations = [-4, 3, -2, 4, -3, 2, -5, 1];
    const rotation = rotations[index % rotations.length];
    return `
        <span class="category-mark-card" style="--sketch-rotate:${rotation}deg">
            <span>${escapeHTML(getCategoryMark(category))}</span>
        </span>
    `;
}

function getGraphSortedCards(list) {
    return list
        .slice()
        .sort((a, b) => {
            const bTime = Date.parse(b.created_at || '');
            const aTime = Date.parse(a.created_at || '');
            const bRank = Number.isNaN(bTime) ? 0 : bTime;
            const aRank = Number.isNaN(aTime) ? 0 : aTime;
            return bRank - aRank || String(b.id || '').localeCompare(String(a.id || ''));
        });
}

function getGraphRelativeDate(dateText) {
    const time = Date.parse(dateText || '');
    if (Number.isNaN(time)) return '刚刚';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(time);
    target.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((today - target) / 86400000));
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    if (days < 14) return '1 周前';
    return dateText;
}

function getGraphUpdatedLabel(group) {
    const latest = getGraphSortedCards(group.cards)[0];
    const relative = getGraphRelativeDate(latest?.created_at || '');
    return relative === '今天' ? '今天更新' : relative;
}

function renderGraphFilterButton(filter, label) {
    return `
        <button type="button" class="graph-filter-pill ${activeGraphFilter === filter ? 'active' : ''}" data-graph-filter="${filter}">
            ${escapeHTML(label)}
        </button>
    `;
}

function renderGraphCategorySelect(groups) {
    const activeLabel = activeGraphCategory || '全部分类';
    const options = [{ category: '', cards: allGraphCardsFallback(groups) }, ...groups]
        .map((group) => `
            <button
                type="button"
                class="graph-category-option ${activeGraphCategory === group.category ? 'active' : ''}"
                data-graph-category-option="${escapeHTML(group.category)}"
            >
                <span>${escapeHTML(group.category || '全部分类')}</span>
                <small>${safeList(group.cards).length} 张</small>
            </button>
        `)
        .join('');
    return `
        <div class="graph-category-select">
            <button type="button" class="graph-category-trigger" data-graph-category-trigger aria-expanded="false">
                <span>${escapeHTML(activeLabel)}</span>
                <i data-lucide="chevron-down"></i>
            </button>
            <div class="graph-category-menu" data-graph-category-menu>
                ${options}
            </div>
        </div>
    `;
}

function allGraphCardsFallback(groups) {
    return groups.flatMap((group) => safeList(group.cards));
}

function renderKnowledgeGraphCard(card, mode = '') {
    const summary = card.core_point || card.summary || safeList(card.key_points)[0] || '点击查看卡片详情';
    return `
        <button type="button" class="graph-card-item ${mode === 'page' ? 'graph-card-item-page' : ''}" data-card-id="${escapeHTML(card.id)}">
            <div class="graph-card-top">
                <span class="graph-card-badge">${escapeHTML(card.category || DEFAULT_CATEGORY)}</span>
                <span class="graph-card-date">${escapeHTML(card.created_at || '')}</span>
            </div>
            <strong class="graph-card-title">${escapeHTML(card.title || '未命名卡片')}</strong>
            <p class="graph-card-summary">${escapeHTML(summary)}</p>
        </button>
    `;
}

function renderKnowledgeGraph() {
    if (!els.knowledgeGraphSection || !els.knowledgeUniverse || !els.knowledgeGraphCards) return;

    const groups = getKnowledgeGraphGroups();
    const totalCount = cards.length;
    const allGraphCards = getGraphSortedCards(groups.flatMap((group) => group.cards));

    if (!groups.length || totalCount === 0) {
        activeGraphCategory = '';
        activeGraphFilter = 'all';
        els.knowledgeUniverse.style.display = 'block';
        els.knowledgeUniverse.innerHTML = `
            <div class="graph-empty">
                <strong>还没有知识宇宙</strong>
                <p>先生成几张卡片，宇宙会自动展开。</p>
            </div>
        `;
        els.knowledgeGraphCards.innerHTML = `
            <div class="graph-cards-empty">
                <p>暂无分类内容</p>
            </div>
        `;
        return;
    }

    const activeGroup = groups.find((group) => group.category === activeGraphCategory) || null;
    if (activeGraphCategory && !activeGroup) activeGraphCategory = '';
    const headerHtml = `
        <div class="graph-page-head">
            <div>
                <h2>知识图谱</h2>
                <p>总览你的知识宇宙</p>
            </div>
        </div>
        <div class="graph-filter-row">
            ${renderGraphCategorySelect(groups)}
        </div>
    `;

    const renderCenterHtml = () => `
        <div class="universe-center">
            <div class="universe-center-logo">
                <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                    <circle cx="24" cy="24" r="4"></circle>
                    <path d="M24 8v8M24 32v8M8 24h8M32 24h8M13 13l6 6M29 29l6 6M35 13l-6 6M19 29l-6 6"></path>
                </svg>
            </div>
            <div class="universe-center-title">我的知识库</div>
            <div class="universe-center-count">${totalCount.toLocaleString()} <span>张卡片</span></div>
            <div class="universe-center-label">持续生长中</div>
        </div>
    `;

    const mapGroups = chunkGraphGroups(groups);
    const mapsHtml = mapGroups.map((groupChunk, mapIndex) => {
        const graphLayout = calculateBubbleLayout(groupChunk.length);
        const orbitHtml = graphLayout.orbits
            .map((orbit) => `<div class="universe-orbit" style="width:${orbit * 2}%;height:${orbit * 2}%;"></div>`)
            .join('');
        const bubblesHtml = groupChunk.map((group, index) => {
            const pos = graphLayout.positions[index];
            const isActive = activeGroup && group.category === activeGroup.category;
            const bgColor = getCategoryColor(group.category);
            return `
                <button
                    type="button"
                    class="universe-bubble ${isActive ? 'active' : ''}"
                    data-graph-category="${escapeHTML(group.category)}"
                    style="left:${pos.x}%;top:${pos.y}%;background:${bgColor};--bubble-size:${pos.size}px;--bubble-font:${pos.fontSize}px;--bubble-count-font:${pos.countFontSize}px;--bubble-icon:${pos.iconSize}px;--bubble-tag-display:${pos.showTag ? 'inline-block' : 'none'};"
                >
                    <span class="universe-bubble-name">${escapeHTML(group.category)}</span>
                    <span class="universe-bubble-count">${group.cards.length} 张卡片</span>
                    <span class="universe-bubble-tag">${escapeHTML(getGraphUpdatedLabel(group))}</span>
                </button>
            `;
        }).join('');
        return `<div class="universe-map ${mapIndex > 0 ? 'universe-map-more' : ''} universe-map-count-${groupChunk.length}">${orbitHtml + renderCenterHtml() + bubblesHtml}</div>`;
    }).join('');

    let railTitle = activeGroup?.category || '';
    let railKicker = activeGroup ? `${activeGroup.cards.length} 张卡片` : '';
    let railCards = activeGroup?.cards || [];
    let emptyText = '暂无分类内容';
    let showDetailPage = !!activeGroup;

    if (!showDetailPage) {
        els.knowledgeUniverse.style.display = 'block';
        els.knowledgeUniverse.innerHTML = headerHtml + `<div class="universe-map-stack">${mapsHtml}</div>`;
        els.knowledgeGraphCards.innerHTML = '';
        els.knowledgeGraphCards.style.display = 'none';
        refreshIcons();
        return;
    }

    els.knowledgeUniverse.style.display = 'none';
    els.knowledgeGraphCards.innerHTML = `
        <div class="graph-list-page">
            <button type="button" class="graph-back-btn" data-graph-back>
                <i data-lucide="arrow-left"></i>
                返回图谱
            </button>
            <div class="graph-card-head">
                <div>
                    <span class="graph-card-head-kicker">知识图谱</span>
                    <strong>${escapeHTML(railTitle)}</strong>
                    <p>${escapeHTML(railKicker)}</p>
                </div>
            </div>
            ${railCards.length
                ? `<div class="graph-mindmap">
                        <div class="graph-mindmap-center">${escapeHTML(activeGraphCategory)}</div>
                        <div class="graph-mindmap-nodes">
                            ${railCards.map((card, idx) => {
                                const points = safeList(card.key_points).map((p, i) => normalizeKeyPoint(p, i));
                                return `<div class="graph-mindmap-card" data-graph-card-id="${card.id}" style="--delay:${idx * 0.06}s">
                                    <div class="graph-mindmap-title">${escapeHTML(card.title || '未命名')}</div>
                                    <div class="graph-mindmap-points">
                                        ${points.slice(0, 4).map(p => `<span class="graph-mindmap-point">${escapeHTML(p.heading)}</span>`).join('')}
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>`
                : `<div class="graph-cards-empty"><p>${escapeHTML(emptyText)}</p></div>`}
        </div>
    `;
    els.knowledgeGraphCards.style.display = 'block';
    refreshIcons();
}

function chunkGraphGroups(groups) {
    const chunkSize = groups.length <= 8 ? groups.length : 8;
    const chunks = [];
    for (let index = 0; index < groups.length; index += chunkSize) {
        chunks.push(groups.slice(index, index + chunkSize));
    }
    return chunks;
}

// 每个圆盘保持可读尺寸；分类多时会拆成多个圆盘纵向排列
function calculateBubbleLayout(count) {
    const centerX = 50;
    const centerY = 50;
    const positions = [];

    const pushRing = (ringCount, startIndex, radius, size, fontSize, countFontSize, iconSize, showTag, angleOffset = -90) => {
        for (let i = 0; i < ringCount; i++) {
            const angle = (360 / ringCount) * i + angleOffset;
            const rad = (angle * Math.PI) / 180;
            const x = centerX + radius * Math.cos(rad);
            const y = centerY + radius * Math.sin(rad);
            positions[startIndex + i] = {
                x: Math.max(10, Math.min(90, Number(x.toFixed(2)))),
                y: Math.max(10, Math.min(90, Number(y.toFixed(2)))),
                size,
                fontSize,
                countFontSize,
                iconSize,
                showTag
            };
        }
    };

    if (count <= 1) {
        pushRing(count, 0, 36, 128, 15, 12, 28, true);
        return { positions, orbits: [36, 22] };
    }

    if (count <= 4) {
        pushRing(count, 0, 38, 124, 15, 12, 28, true);
        return { positions, orbits: [38, 22] };
    }

    if (count <= 6) {
        pushRing(count, 0, 39, 112, 14, 11, 25, true);
        return { positions, orbits: [39, 22] };
    }

    if (count <= 8) {
        pushRing(count, 0, 36, 92, 13, 11, 23, true);
        return { positions, orbits: [37, 22] };
    }

    pushRing(count, 0, 37, 82, 12, 10, 21, false);
    return { positions, orbits: [38, 22] };
}

// 绑定事件
function bindEvents() {
    // 生成卡片
    els.btnGenerate.addEventListener('click', handleGenerateCard);
    
    // 分类点击 (领域内搜索)
    els.categoryList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.category-delete');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            deleteCategory(deleteBtn.dataset.deleteCategory);
            return;
        }
        const btn = e.target.closest('.category-tag');
        if (!btn) return;
        setCurrentCategory(btn.dataset.category);
    });
    
    // 搜索
    els.searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.trim().toLowerCase();
        els.btnClearSearch.classList.toggle('hidden', !currentSearch);
        closeSearchResults();
        renderCards();
    });
    els.btnClearSearch.addEventListener('click', () => {
        els.searchInput.value = '';
        currentSearch = '';
        els.btnClearSearch.classList.add('hidden');
        closeSearchResults();
        renderCards();
    });
    bindCloseButton(els.btnCloseSearch, closeSearchResults);
    
    // 卡片选择与操作
    els.btnCancelSelect.addEventListener('click', () => {
        selectedCards.clear();
        updateBatchActions();
        renderCards();
    });
    
    els.btnIntegrate.addEventListener('click', handleIntegrateCards);
    els.btnExport.addEventListener('click', handleExportImages);

    els.cardsContainer.addEventListener('click', (e) => {
        const starBtn = e.target.closest('.card-favorite-toggle');
        if (!starBtn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        const card = cards.find(item => item.id === starBtn.dataset.id);
        if (card) toggleFavoriteCard(card);
    }, true);
    
    // 详情弹窗
    bindCloseButton(els.btnCloseModal, closeCardModal);
    bindBackdropClose(els.cardModal, closeCardModal);
    bindBackdropClose(els.searchModal, closeSearchResults);
    bindBackdropClose(els.actionModal, closeActionModal);
    bindBackdropClose(els.notebookModal, closeNotebookModal);
    bindBackdropClose(els.flashcardModal, closeFlashcardModal);
    bindBackdropClose(els.settingsModal, closeSettingsModal);
    bindBackdropClose(els.integratePreviewModal, closeIntegratePreview);
    
    els.btnDeleteCard.addEventListener('click', () => {
        if (!currentViewCardId) return;
        if (confirm('确定要删除这张卡片吗？')) {
            const deletedId = currentViewCardId;
            cards = cards.filter(c => c.id !== deletedId);
            selectedCards.delete(deletedId);
            if (currentActionCardId === deletedId) currentActionCardId = null;
            if (currentReviewCardId === deletedId) currentReviewCardId = null;
            if (reviewSession && reviewSession.cardIds) {
                reviewSession.cardIds = reviewSession.cardIds.filter(id => id !== deletedId);
            }
            saveCards();
            closeCardModal();
            renderCategoryNav();
            updateBatchActions();
            renderCards();
            renderDailyReview();
        }
    });
    
    els.btnAddTodo.addEventListener('click', handleGetCard);
    els.btnEditCard.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentViewCardId);
        if (card) openCardDetail(card, true);
    });
    els.btnCancelEdit.addEventListener('click', () => {
        pendingEditMarks = {};
        const card = cards.find(c => c.id === currentViewCardId);
        if (card) openCardDetail(card, false);
    });
    els.btnSaveCard.addEventListener('click', saveEditedCard);
    if (els.btnOpenNotebook) {
        els.btnOpenNotebook.addEventListener('click', openNotebook);
    }
    if (els.btnCloseNotebook) {
        bindCloseButton(els.btnCloseNotebook, closeNotebookModal);
    }
    if (els.btnSaveNotebook) {
        els.btnSaveNotebook.addEventListener('click', saveNotebook);
    }

    // 整合预览弹窗
    bindCloseButton(els.btnCloseIntegratePreview, closeIntegratePreview);
    els.btnCancelIntegrate.addEventListener('click', closeIntegratePreview);
    els.btnConfirmIntegrate.addEventListener('click', confirmIntegrate);

    els.btnActionCancel.addEventListener('click', closeActionModal);
    els.btnActionDetail.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentActionCardId);
        closeActionModal();
        if (card) openCardDetail(card);
    });

    els.reviewCountPicker.addEventListener('click', (e) => {
        const button = e.target.closest('[data-review-count]');
        if (!button) return;
        const nextCount = clamp(button.dataset.reviewCount, 3, 5);
        if (nextCount === dailyReviewSettings.cardCount) return;
        dailyReviewSettings.cardCount = nextCount;
        saveReviewSettings();
        reviewSession = ensureDailyReviewSession(true);
        renderDailyReview();
    });
    els.btnReviewSkip.addEventListener('click', (e) => {
        e.stopPropagation();
        skipCurrentReviewCard();
    });
    els.btnReviewDo.addEventListener('click', (e) => {
        e.stopPropagation();
        openSwipeReview();
    });
    els.reviewHeading.addEventListener('click', openSwipeReview);
    els.reviewQueueLabel.addEventListener('click', openSwipeReview);
    els.reviewStreakButton.addEventListener('click', showReviewStats);

    // 点击今日复习卡片翻转
    els.reviewCard.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return; // 不拦截按钮点击
        if (reviewSession.completed || !currentReviewCardId) return;
        if (reviewSession.completed || !currentReviewCardId) return;
        if (reviewCardFlipped) return;
        setReviewCardFlip(true);
    });

    // 滑动复习弹窗
    bindCloseButton(els.btnCloseSwipeReview, closeSwipeReview);
    bindBackdropClose(els.swipeModal, closeSwipeReview);
    els.btnSwipeDoneClose.addEventListener('click', startQuizMode);
    els.btnQuizCompleteClose.addEventListener('click', closeSwipeReview);
    els.btnSwipeUnderstood.addEventListener('click', () => handleSwipeDecision('understood'));
    els.btnSwipeConfused.addEventListener('click', () => handleSwipeDecision('confused'));
    bindSwipeReviewGestures();
    
    // 闪卡复习
    if (els.btnFlashcard) els.btnFlashcard.addEventListener('click', startFlashcardMode);
    bindCloseButton(els.btnCloseFlashcard, closeFlashcardModal);
    els.flashcardElement.addEventListener('click', () => {
        els.flashcardElement.classList.add('is-flipped');
        els.fcActions.classList.remove('hidden');
    });
    els.btnFcForget.addEventListener('click', (e) => {
        e.stopPropagation();
        nextFlashcard(false);
    });
    els.btnFcRemember.addEventListener('click', (e) => {
        e.stopPropagation();
        nextFlashcard(true);
    });
    
    // 设置 API Key
    els.btnSettings.addEventListener('click', () => {
        els.apiKeyInput.value = API_KEY;
        els.settingsModal.classList.remove('hidden');
    });
    bindCloseButton(els.btnCloseSettings, closeSettingsModal);
    els.btnSaveSettings.addEventListener('click', () => {
        API_KEY = els.apiKeyInput.value.trim();
        if (API_KEY) {
            sessionStorage.setItem('deepseek_api_key', API_KEY);
        } else {
            sessionStorage.removeItem('deepseek_api_key');
        }
        els.settingsModal.classList.add('hidden');
        alert(API_KEY ? 'API Key 已保存到当前会话' : 'API Key 已清空');
    });
    bindCloseButton(els.btnCloseReviewStats, closeReviewStats);
    els.reviewStatsModal.addEventListener('click', (e) => {
        if (e.target === els.reviewStatsModal) closeReviewStats();
    });

    document.querySelectorAll('[data-mobile-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-mobile-action]').forEach((item) => item.classList.remove('active'));
            btn.classList.add('active');

            const action = btn.dataset.mobileAction;
            currentView = action;
            currentCategory = '全部';
            renderCategoryNav();

            // 输入区只在首页显示
            const composeSection = document.getElementById('compose-section');
            if (composeSection) {
                composeSection.style.display = action === 'home' ? '' : 'none';
            }
            if (els.reviewSection) {
                els.reviewSection.classList.toggle('hidden', action === 'graph');
            }
            if (els.toolbar) {
                els.toolbar.style.display = action === 'graph' ? 'none' : '';
            }
            if (els.batchActions) {
                els.batchActions.classList.add('hidden');
            }
            if (els.cardsContainer) {
                els.cardsContainer.style.display = action === 'graph' ? 'none' : '';
            }
            if (els.knowledgeGraphSection) {
                els.knowledgeGraphSection.classList.toggle('hidden', action !== 'graph');
            }

            if (action === 'graph') {
                renderKnowledgeGraph();
                els.knowledgeGraphSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                renderCards();
                els.cardsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    els.knowledgeUniverse.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-graph-category-trigger]');
        if (trigger) {
            const wrapper = trigger.closest('.graph-category-select');
            const isOpen = wrapper?.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', String(!!isOpen));
            return;
        }
        const option = e.target.closest('[data-graph-category-option]');
        if (option) {
            activeGraphCategory = normalizeCategory(option.dataset.graphCategoryOption || '');
            activeGraphFilter = 'all';
            renderKnowledgeGraph();
            if (activeGraphCategory && els.knowledgeGraphCards) {
                els.knowledgeGraphCards.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }
        const cardNode = e.target.closest('[data-card-id]');
        if (cardNode) {
            const card = cards.find((entry) => entry.id === cardNode.dataset.cardId);
            if (card) openCardActions(card);
            return;
        }
        const bubble = e.target.closest('[data-graph-category]');
        if (!bubble) return;
        activeGraphCategory = normalizeCategory(bubble.dataset.graphCategory);
        activeGraphFilter = 'all';
        renderKnowledgeGraph();
        if (els.knowledgeGraphCards) {
            els.knowledgeGraphCards.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    els.knowledgeGraphCards.addEventListener('click', (e) => {
        const backBtn = e.target.closest('[data-graph-back]');
        if (backBtn) {
            activeGraphCategory = '';
            activeGraphFilter = 'all';
            renderKnowledgeGraph();
            els.knowledgeUniverse.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        const item = e.target.closest('[data-card-id]') || e.target.closest('[data-graph-card-id]');
        if (!item) return;
        const cardId = item.dataset.cardId || item.dataset.graphCardId;
        const card = cards.find((entry) => entry.id === cardId);
        if (card) openCardActions(card);
    });
}

// 渲染卡片列表
function bindCloseButton(button, handler) {
    if (!button) return;
    const close = (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
    };
    button.addEventListener('click', close);
    button.addEventListener('pointerup', close);
    button.addEventListener('touchend', close, { passive: false });
}

function bindBackdropClose(modal, handler) {
    if (!modal) return;
    modal.addEventListener('click', (event) => {
        if (event.target === modal) handler();
    });
}

function closeActionModal() {
    els.actionModal.classList.add('hidden');
    currentActionCardId = null;
}

function closeCardModal() {
    els.cardModal.classList.add('hidden');
    currentViewCardId = null;
    isEditingCard = false;
}

function closeNotebookModal() {
    els.notebookModal.classList.add('hidden');
}

function closeFlashcardModal() {
    els.flashcardModal.classList.add('hidden');
}

function closeSettingsModal() {
    els.settingsModal.classList.add('hidden');
}

function renderCards() {
    if (currentView === 'graph') {
        if (els.reviewSection) els.reviewSection.classList.add('hidden');
        if (els.toolbar) els.toolbar.style.display = 'none';
        if (els.batchActions) els.batchActions.classList.add('hidden');
        if (els.cardsContainer) els.cardsContainer.style.display = 'none';
        if (els.knowledgeGraphSection) els.knowledgeGraphSection.classList.remove('hidden');
        renderKnowledgeGraph();
        return;
    }

    if (els.reviewSection) els.reviewSection.classList.remove('hidden');
    if (els.toolbar) els.toolbar.style.display = '';
    if (els.cardsContainer) els.cardsContainer.style.display = '';
    if (els.knowledgeGraphSection) els.knowledgeGraphSection.classList.add('hidden');

    let filtered = cards;

    // 1. 底部导航状态过滤
    if (currentView === 'unread') {
        filtered = filtered.filter(c => !c.isRead);
    } else if (currentView === 'read') {
        filtered = filtered.filter(c => c.isRead);
    } else if (currentView === 'favorites') {
        filtered = filtered.filter(c => c.isFavorite);
    }
    // home: 不过滤状态，显示全部

    // 2. 顶部内容分类过滤
    if (currentCategory !== '全部') {
        filtered = filtered.filter(c => normalizeCategory(c.category) === currentCategory);
    }

    // 3. 当前范围内搜索：只筛选当前底部视图和当前分类里的卡片
    if (currentSearch) {
        filtered = filtered.filter(card => cardMatchesSearch(card, currentSearch));
    }

    // 渲染
    els.cardsContainer.innerHTML = '';

    console.log('[Zcard] renderCards: 过滤后卡片数量:', filtered.length);

    if (filtered.length === 0) {
        console.log('[Zcard] 显示空状态');
        els.emptyState.classList.remove('hidden');
        const emptyText = els.emptyState.querySelector('p');
        if (emptyText) {
            emptyText.textContent = currentSearch
                ? `没有找到“${currentSearch}”相关卡片`
                : '还没有知识卡片，快去粘贴文案生成一张吧！';
        }
        els.cardsContainer.appendChild(els.emptyState);
        return;
    }
    
    els.emptyState.classList.add('hidden');
    
    filtered.forEach(card => {
        const isIntegratedCard = !!(card.isIntegrated || card.is_integrated);
        const isSelected = selectedCards.has(card.id);
        const canSelectForIntegrate = !isIntegratedCard && !card.is_todo;
        const cardEl = document.createElement('div');
        normalizeCard(card);
        cardEl.dataset.cardId = card.id;
        cardEl.className = `knowledge-card-wrap ${isIntegratedCard ? 'integrated' : ''} ${card.isFavorite ? 'favorite-card' : ''} ${card.isRead ? 'read-card' : ''} ${card.is_todo && card.todo_status === '已完成' ? 'todo-completed' : ''} ${isSelected ? 'is-selected' : ''}`;
        
        const starHtml = `
            <button type="button" class="card-favorite-toggle ${card.isFavorite ? 'active' : ''}" data-id="${escapeHTML(card.id)}" title="${card.isFavorite ? '取消收藏' : '收藏'}" aria-label="${card.isFavorite ? '取消收藏' : '收藏'}">
                <i data-lucide="star"></i>
            </button>
        `;
        const selectHtml = canSelectForIntegrate ? `
            <button type="button" class="card-select-toggle ${isSelected ? 'active' : ''}" data-id="${escapeHTML(card.id)}" title="${isSelected ? '取消勾选' : '勾选整合'}" aria-label="${isSelected ? '取消勾选' : '勾选整合'}">
                <i data-lucide="${isSelected ? 'check-check' : 'circle'}"></i>
            </button>
        ` : '';
        const badgeText = isIntegratedCard
            ? MERGED_CATEGORY
            : (card.is_todo ? '待办' : card.category);
        
        cardEl.innerHTML = `
            <button type="button" class="swipe-delete" data-id="${escapeHTML(card.id)}">
                <i data-lucide="trash-2"></i>
                <span>删除</span>
            </button>
            <div class="knowledge-card swipe-card">
                <div class="card-header">
                    <div class="card-header-actions">
                        ${selectHtml}
                        <span class="card-badge">${escapeHTML(badgeText)}</span>
                    </div>
                    ${starHtml}
                </div>
                <h3 class="card-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h3>
                <p class="card-core" ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point || card.summary || '')}</p>
                <div class="card-footer">
                    <span>${escapeHTML(card.created_at)}</span>
                    ${card.isDemo ? '<span class="demo-hint">演示卡</span>' : ''}
                </div>
            </div>
        `;
        
        // 卡片点击事件 (打开详情)
        cardEl.addEventListener('click', (e) => {
            if (cardEl.dataset.swipeSuppressClick === 'true') {
                e.preventDefault();
                e.stopPropagation();
                delete cardEl.dataset.swipeSuppressClick;
                return;
            }
            if (cardEl.dataset.swipeJustOpened === 'true') {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (cardEl.classList.contains('swiped')) {
                e.preventDefault();
                e.stopPropagation();
                if (e.target.closest('.swipe-delete')) return;
                cardEl.classList.remove('swiped');
                cardEl.querySelector('.swipe-card').style.transform = '';
                return;
            }
            if (e.target.closest('.card-favorite-toggle') || e.target.closest('.swipe-delete')) return;
            openCardActions(card);
        });

        const deleteBtn = cardEl.querySelector('.swipe-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm('确定删除这张卡片吗？')) return;
            cards = cards.filter(item => item.id !== card.id);
            selectedCards.delete(card.id);
            saveCards();
            updateBatchActions();
            renderCategoryNav();
            renderCards();
            renderDailyReview();
        });

        const starBtn = cardEl.querySelector('.card-favorite-toggle');
        ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach((eventName) => {
            starBtn.addEventListener(eventName, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });

        const selectBtn = cardEl.querySelector('.card-select-toggle');
        if (selectBtn) {
            ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach((eventName) => {
                selectBtn.addEventListener(eventName, (e) => {
                    e.stopPropagation();
                }, { passive: true });
            });
            selectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selectedCards.has(card.id)) {
                    selectedCards.delete(card.id);
                } else {
                    selectedCards.add(card.id);
                }
                updateBatchActions();
                renderCards();
            });
        }

        bindSwipeToDelete(cardEl);
        
        els.cardsContainer.appendChild(cardEl);
    });
    refreshIcons();
}

function focusGeneratedCard(cardId) {
    const scheduleFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
    scheduleFrame(() => {
        scheduleFrame(() => {
            const newCardEl = Array.from(els.cardsContainer.children)
                .find((item) => item.dataset.cardId === cardId);
            const scroller = document.querySelector('.main-content') || document.scrollingElement || document.documentElement;
            if (!newCardEl || !scroller) return;

            const scrollerRect = scroller.getBoundingClientRect();
            const cardRect = newCardEl.getBoundingClientRect();
            const targetTop = scroller.scrollTop + cardRect.top - scrollerRect.top - 12;
            scroller.scrollTo({
                top: Math.max(0, targetTop),
                behavior: 'smooth'
            });
            newCardEl.classList.add('is-new');
            window.setTimeout(() => newCardEl.classList.remove('is-new'), 1800);
            console.log('[Zcard] 已滚动到新卡片:', cardId);
        });
    });
}

function cardMatchesSearch(card, keyword) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return false;
    const haystack = [
        card.title,
        card.category,
        card.core_point,
        card.summary,
        card.note,
        card.video_link,
        ...safeList(card.key_points).map((point, index) => pointPlainText(point, index)),
        ...safeList(card.source_titles),
        ...safeList(card.source_links),
        ...safeList(card.angles)
    ].join(' ').toLowerCase();
    return haystack.includes(normalized);
}

function showSearchResults(keyword) {
    const results = cards.filter(card => cardMatchesSearch(card, keyword));
    els.searchResultTitle.textContent = `搜索结果 - "${keyword}"`;
    els.searchResultCount.textContent = results.length ? `共找到 ${results.length} 张卡片` : '未找到相关卡片';
    els.searchResults.innerHTML = results.length
        ? results.map(card => renderResultCardHTML(card)).join('')
        : '';
    els.searchResults.querySelectorAll('.search-result-card').forEach((cardEl) => {
        cardEl.addEventListener('click', () => {
            const card = cards.find(item => item.id === cardEl.dataset.id);
            closeSearchResults();
            if (card) openCardActions(card);
        });
    });
    els.searchModal.classList.remove('hidden');
    refreshIcons();
}

function closeSearchResults() {
    els.searchModal.classList.add('hidden');
}

function renderResultCardHTML(card) {
    normalizeCard(card);
    return `
        <article class="knowledge-card search-result-card ${card.isFavorite ? 'favorite-card' : ''}" data-id="${escapeHTML(card.id)}">
            <div class="card-header">
                <span class="card-badge">${escapeHTML(card.category || DEFAULT_CATEGORY)}</span>
                ${card.isFavorite ? '<span class="favorite-star" title="已收藏">⭐</span>' : ''}
            </div>
            <h3 class="card-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h3>
            <p class="card-core" ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point || card.summary || '')}</p>
        </article>
    `;
}

function updateCollectionTabState() {
    renderCategoryNav();
}

function toggleFavoriteCard(card) {
    normalizeCard(card);
    card.isFavorite = !card.isFavorite;
    saveCards();
    renderCards();
}

function bindSwipeToDelete(cardEl) {
    const swipeCard = cardEl.querySelector('.swipe-card');
    const openOffset = -84;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let currentOffset = 0;
    let dragging = false;
    let startedSwiped = false;

    const resetDragStyle = () => {
        swipeCard.style.transition = '';
    };

    const start = (event) => {
        startX = event.clientX;
        startY = event.clientY;
        startedSwiped = cardEl.classList.contains('swiped');
        startOffset = startedSwiped ? openOffset : 0;
        currentOffset = startOffset;
        dragging = true;
        swipeCard.style.transition = 'none';
        swipeCard.setPointerCapture?.(event.pointerId);
    };

    const move = (event) => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) return;
        cardEl.classList.remove('swiped');
        currentOffset = Math.min(0, Math.max(openOffset, startOffset + dx));
        event.preventDefault();
        swipeCard.style.transform = `translateX(${currentOffset}px)`;
    };

    const end = (event) => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        dragging = false;
        resetDragStyle();
        if (startedSwiped && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
            cardEl.classList.remove('swiped');
            swipeCard.style.transform = '';
            cardEl.dataset.swipeSuppressClick = 'true';
            window.setTimeout(() => {
                delete cardEl.dataset.swipeSuppressClick;
            }, 350);
            return;
        }
        if (currentOffset <= -42) {
            cardEl.classList.add('swiped');
            cardEl.dataset.swipeJustOpened = 'true';
            swipeCard.style.transform = `translateX(${openOffset}px)`;
            window.setTimeout(() => {
                delete cardEl.dataset.swipeJustOpened;
            }, 350);
        } else {
            cardEl.classList.remove('swiped');
            swipeCard.style.transform = '';
        }
    };

    swipeCard.addEventListener('pointerdown', start);
    swipeCard.addEventListener('pointermove', move);
    swipeCard.addEventListener('pointerup', end);
    swipeCard.addEventListener('pointercancel', end);
    swipeCard.addEventListener('click', (event) => {
        event.preventDefault();
        if (cardEl.dataset.swipeJustOpened === 'true') {
            event.stopPropagation();
            return;
        }
        if (!cardEl.classList.contains('swiped')) return;
        event.stopPropagation();
        cardEl.classList.remove('swiped');
        swipeCard.style.transform = '';
    });
}

function openCardActions(card) {
    currentActionCardId = card.id;
    const sourceUrl = safeUrl(card.video_link);
    if (sourceUrl) {
        els.btnActionDouyin.href = sourceUrl;
        els.btnActionDouyin.classList.remove('disabled');
    } else {
        els.btnActionDouyin.removeAttribute('href');
        els.btnActionDouyin.classList.add('disabled');
    }
    els.actionModal.classList.remove('hidden');
    refreshIcons();
}

function updateBatchActions() {
    const existingIds = new Set(cards.map((card) => card.id));
    [...selectedCards].forEach((id) => {
        if (!existingIds.has(id)) {
            selectedCards.delete(id);
        }
    });
    els.selectedNum.textContent = selectedCards.size;
    if (selectedCards.size > 0) {
        els.batchActions.classList.remove('hidden');
        els.btnIntegrate.style.display = selectedCards.size >= 2 ? 'inline-flex' : 'none';
        els.btnIntegrate.innerHTML = `<i data-lucide="git-merge"></i> 整合 ${Math.max(selectedCards.size, 2)} 张`;
        refreshIcons();
    } else {
        els.batchActions.classList.add('hidden');
    }
}

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

function getReviewRingTheme(streakDays) {
    if (streakDays >= 7) {
        return { color: '#d4a94f', label: '金色冲刺' };
    }
    if (streakDays >= 4) {
        return { color: '#7c5cff', label: '紫色稳定期' };
    }
    if (streakDays >= 1) {
        return { color: '#4f8cff', label: '蓝色起势中' };
    }
    return { color: '#b6b3ac', label: '灰阶起步' };
}

function getAllReviewCandidates() {
    return cards.filter((card) => normalizeCard(card).isRead && !card.is_todo);
}

function pickDailyReviewCards() {
    const candidates = getAllReviewCandidates();
    if (candidates.length === 0) return [];

    return shuffleArray(candidates).slice(0, Math.min(dailyReviewSettings.cardCount, candidates.length));
}

function ensureDailyReviewSession(forceNew = false) {
    const today = todayKey();
    const validIds = new Set(getAllReviewCandidates().map((card) => card.id));
    const stored = loadReviewSession();

    if (!forceNew && stored.date === today) {
        const nextSession = normalizeReviewSession({
            ...stored,
            cardIds: stored.cardIds.filter((id) => validIds.has(id)),
            skippedIds: stored.skippedIds.filter((id) => validIds.has(id))
        });

        if (nextSession.completed || nextSession.cardIds.length > 0) {
            reviewSession = nextSession;
            saveReviewSession(reviewSession);
            return reviewSession;
        }
    }

    reviewSession = normalizeReviewSession({
        date: today,
        cardIds: pickDailyReviewCards().map((card) => card.id),
        skippedIds: [],
        completed: false,
        completedAt: '',
        correctCount: 0,
        wrongCount: 0
    });
    saveReviewSession(reviewSession);
    return reviewSession;
}

function getReviewQueueIds(session = reviewSession) {
    return safeList(session.cardIds).filter((id) => !safeList(session.skippedIds).includes(id) && cards.some((c) => c.id === id));
}

function getCardById(cardId) {
    return cards.find((card) => card.id === cardId) || null;
}

function includeCardInTodayReviewSession(cardId) {
    if (!cardId) return;
    const card = getCardById(cardId);
    if (!card || !normalizeCard(card).isRead || card.is_todo) return;
    reviewSession = ensureDailyReviewSession(cards.length > 0 ? false : true);

    const normalizedIds = safeList(reviewSession.cardIds).filter((id) => id !== cardId);
    reviewSession.cardIds = [cardId, ...normalizedIds];
    reviewSession.skippedIds = safeList(reviewSession.skippedIds).filter((id) => id !== cardId);
    // 不重置已完成的复习状态，只把新卡片加入队列
    saveReviewSession(reviewSession);
}

function setReviewCardFlip(flipped) {
    reviewCardFlipped = !!flipped;
    els.reviewCard.classList.toggle('is-flipped', reviewCardFlipped);
}

function applyReviewStats() {
    const stats = loadReviewStats();
    const theme = getReviewRingTheme(stats.streakDays);
    const progress = Math.min(100, Math.round((Math.min(stats.streakDays, REVIEW_RING_GOAL) / REVIEW_RING_GOAL) * 100));

    els.reviewStreakRing.style.setProperty('--ring-progress', `${Math.max(progress, stats.streakDays ? 18 : 0)}%`);
    els.reviewStreakRing.style.setProperty('--ring-color', theme.color);
    els.reviewStreakDays.textContent = String(stats.streakDays);
    els.reviewStreakLabel.textContent = theme.label;
    if (els.reviewPowerTotal) {
        els.reviewPowerTotal.textContent = `知识力 ${stats.knowledgePower}`;
    }
    return stats;
}

function resetReviewCardContent() {
    setReviewCardFlip(false);
    els.btnReviewDo.classList.remove('hidden');
    els.btnReviewSkip.classList.remove('hidden');
    els.reviewSection.classList.remove('hidden');
}

function setDailyReviewEntry(streakDays, remainingCount, disabled = false) {
    const text = remainingCount > 0 ? `今日剩余${remainingCount}张` : '今日无待回顾';
    if (els.reviewMainEntryText) {
        els.reviewMainEntryText.textContent = text;
    }
    els.reviewQueueLabel.textContent = `${streakDays}天，${text}`;
    els.reviewHeading.disabled = !!disabled;
    els.reviewQueueLabel.disabled = !!disabled;
}

function showReviewStats() {
    const stats = loadReviewStats();
    const today = todayKey();
    const doneToday = reviewSession?.completed && reviewSession.date === today;
    els.reviewStatsStreak.textContent = String(stats.streakDays);
    els.reviewStatsTotal.textContent = String(stats.totalSessions);
    els.reviewStatsPower.textContent = String(stats.knowledgePower);
    els.reviewStatsStatus.textContent = doneToday ? '今日已完成，明天继续从已读卡片里抽取。' : '今日未完成，点今日回顾即可开始。';
    els.reviewStatsModal.classList.remove('hidden');
}

function closeReviewStats() {
    els.reviewStatsModal.classList.add('hidden');
}

function renderDailyReview() {
    const allCandidates = getAllReviewCandidates();
    const stats = applyReviewStats();
    dailyReviewSettings = loadReviewSettings();
    reviewSession = ensureDailyReviewSession(allCandidates.length > 0 ? false : true);

    els.reviewCountPicker.querySelectorAll('[data-review-count]').forEach((button) => {
        button.classList.toggle('active', Number(button.dataset.reviewCount) === dailyReviewSettings.cardCount);
    });

    if (allCandidates.length === 0) {
        currentReviewCardId = null;
        resetReviewCardContent();
        setDailyReviewEntry(stats.streakDays, 0, true);
        els.reviewSubtext.textContent = '点击卡片详情里的 Get it 后，卡片才会进入每日回顾。';
        els.reviewMetaText.textContent = '每日回顾';
        els.reviewBackMeta.textContent = '今日队列';
        els.reviewTitle.textContent = '还没有已读卡片';
        els.reviewCore.textContent = '先打开一张卡片，点击 Get it，把它加入已读和回顾池。';
        els.reviewBackTitle.textContent = '暂无回顾内容';
        els.reviewBackCore.textContent = '已读卡片会自动进入每日回顾。';
        els.reviewHint.textContent = 'Get it 后，这里会显示今日回顾入口。';
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        return;
    }

    const queueIds = getReviewQueueIds(reviewSession);
    const queueCards = queueIds.map(getCardById).filter(Boolean);
    const currentCard = queueCards[0] || null;
    currentReviewCardId = currentCard?.id || null;
    resetReviewCardContent();

    if (reviewSession.completed) {
        setDailyReviewEntry(stats.streakDays, 0, true);
        els.reviewSubtext.textContent = '今日回顾已完成，明天会刷新新的已读卡片队列。';
        els.reviewMetaText.textContent = '今日已完成';
        els.reviewBackMeta.textContent = '完成状态';
        els.reviewTitle.textContent = '恭喜您已经完成本次打卡';
        els.reviewCore.textContent = `本轮答题答对 ${reviewSession.correctCount} 题，答错 ${reviewSession.wrongCount} 题，连续打卡 ${stats.streakDays} 天。`;
        els.reviewBackTitle.textContent = '每日回顾已完成';
        els.reviewBackCore.textContent = '进度环已更新，明天会继续从已读卡片中抽取。';
        els.reviewHint.textContent = '今日任务完成，继续保持连续打卡。';
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        return;
    }

    if (!currentCard) {
        setDailyReviewEntry(stats.streakDays, 0, true);
        els.reviewSubtext.textContent = '当前每日回顾队列已经处理完毕。';
        els.reviewMetaText.textContent = '每日回顾';
        els.reviewBackMeta.textContent = '今日队列';
        els.reviewTitle.textContent = '今天没有待处理卡片了';
        els.reviewCore.textContent = '你已经跳过或处理完今天抽到的全部卡片。';
        els.reviewBackTitle.textContent = '今日队列已清空';
        els.reviewBackCore.textContent = '明天会从已读卡片里生成新的回顾队列。';
        els.reviewHint.textContent = '今日队列处理完成。';
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        return;
    }

    setDailyReviewEntry(stats.streakDays, queueCards.length, false);
    els.reviewSubtext.textContent = '点击上方文字开始回顾；仅从已读卡片中抽取。';
    els.reviewMetaText.textContent = `每日回顾 · 剩余 ${queueCards.length} 张`;
    els.reviewBackMeta.textContent = `今日队列 · ${queueCards.length} 张`;
    els.reviewTitle.textContent = currentCard.title || '知识复习';
    els.reviewCore.textContent = currentCard.core_point || currentCard.summary || '点击翻转后开始今天的固定模板答题复习。';
    els.reviewBackTitle.textContent = currentCard.title || '开始今日复习';
    els.reviewBackCore.textContent = '先完成左滑右滑快速回忆，再进入核心观点选择题。';
    els.reviewHint.textContent = '点击上方每日回顾文字开始。';
}

function skipCurrentReviewCard() {
    reviewSession = ensureDailyReviewSession();
    const queueIds = getReviewQueueIds(reviewSession);
    const currentId = queueIds[0];
    if (!currentId) return;
    if (!reviewSession.skippedIds.includes(currentId)) {
        reviewSession.skippedIds.push(currentId);
    }
    saveReviewSession(reviewSession);
    renderDailyReview();
}

function resetSwipeReviewFlow() {
    window.clearTimeout(quizTransitionTimer);
    swipeReviewQueue = [];
    swipeReviewIndex = 0;
    swipeUnderstood = 0;
    swipeConfused = 0;
    swipeReviewResults = {};
    activeReviewIds = [];
    quizQueue = [];
    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    quizLocked = false;
    currentQuizQuestion = null;
    els.swipeDone.classList.add('hidden');
    els.quizStage.classList.add('hidden');
    els.quizComplete.classList.add('hidden');
    els.quizFeedback.classList.add('hidden');
    els.quizFeedback.textContent = '';
    els.quizOptions.innerHTML = '';
    els.swipeScene.style.display = '';
    els.swipeHead.style.display = '';
    els.swipeCard.style.transform = '';
    els.swipeCard.style.opacity = '1';
    els.swipeCard.classList.remove('swiping-left', 'swiping-right');
}

function openSwipeReview() {
    reviewSession = ensureDailyReviewSession();
    const nextReviewIds = getReviewQueueIds(reviewSession);
    const nextSwipeQueue = nextReviewIds.map(getCardById).filter(Boolean);
    if (nextSwipeQueue.length === 0) {
        alert('今天的每日回顾队列已经空了。');
        renderDailyReview();
        return;
    }

    resetSwipeReviewFlow();
    setReviewCardFlip(false);
    activeReviewIds = [...nextReviewIds];
    swipeReviewQueue = [...nextSwipeQueue];
    els.swipeModal.classList.remove('hidden');
    renderSwipeReviewCard();
}

function closeSwipeReview() {
    resetSwipeReviewFlow();
    els.swipeModal.classList.add('hidden');
    renderDailyReview();
}

function finishSwipeReview() {
    els.swipeScene.style.display = 'none';
    els.swipeActionsBar.classList.add('hidden');
    els.swipeGestureHint.classList.add('hidden');
    els.swipeHead.style.display = 'none';
    els.swipeStatUnderstood.textContent = swipeUnderstood;
    els.swipeStatConfused.textContent = swipeConfused;
    els.swipeDone.classList.remove('hidden');
}

function renderSwipeReviewCard() {
    if (swipeReviewIndex >= swipeReviewQueue.length) {
        finishSwipeReview();
        return;
    }
    const card = swipeReviewQueue[swipeReviewIndex];
    els.swipeProgress.textContent = `${swipeReviewIndex + 1} / ${swipeReviewQueue.length}`;
    els.srCategory.textContent = card.category || DEFAULT_CATEGORY;
    els.srTitle.textContent = card.title || '';
    els.srCore.textContent = card.core_point || card.summary || '';
    els.srPoints.innerHTML = safeList(card.key_points).map((point, index) => `<li>${escapeHTML(pointPlainText(point, index))}</li>`).join('');
    els.swipeCard.style.transform = '';
    els.swipeCard.style.opacity = '1';
    els.swipeCard.classList.remove('swiping-left', 'swiping-right');
    els.swipeArrowLeft.style.opacity = '0';
    els.swipeArrowRight.style.opacity = '0';
    els.swipeActionsBar.classList.remove('hidden');
    els.swipeGestureHint.classList.remove('hidden');
    refreshIcons();
}

function handleSwipeDecision(direction) {
    if (!swipeReviewQueue.length || swipeReviewIndex >= swipeReviewQueue.length) return;
    const currentCard = swipeReviewQueue[swipeReviewIndex];
    if (!currentCard) return;

    const understood = direction === 'understood';
    if (understood) {
        swipeUnderstood++;
        swipeReviewResults[currentCard.id] = 'understood';
    } else {
        swipeConfused++;
        swipeReviewResults[currentCard.id] = 'confused';
    }

    els.swipeArrowLeft.style.opacity = understood ? '1' : '0';
    els.swipeArrowRight.style.opacity = understood ? '0' : '1';
    els.swipeCard.classList.toggle('swiping-left', understood);
    els.swipeCard.classList.toggle('swiping-right', !understood);
    els.swipeCard.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease';
    els.swipeCard.style.transform = understood
        ? 'translateX(-110%) rotate(-10deg)'
        : 'translateX(110%) rotate(10deg)';
    els.swipeCard.style.opacity = '0';

    window.setTimeout(() => {
        els.swipeCard.style.transition = '';
        swipeReviewIndex++;
        renderSwipeReviewCard();
    }, 320);
}

function getQuizPrompt(card) {
    return String(card.core_point || card.summary || safeList(card.key_points)[0] || card.title || '').trim();
}

function trimOptionText(text, max = 86) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function getDistractorTexts(currentCard) {
    const points = safeList(currentCard.key_points).map((point, index) => normalizeKeyPoint(point, index));
    const core = getQuizPrompt(currentCard);
    const title = currentCard.title || '';
    const candidates = [];

    // 用 key_points 的内容改造为干扰项
    if (points.length >= 1 && points[0].content) {
        candidates.push(trimOptionText(points[0].content));
    }
    if (points.length >= 2 && points[1].content) {
        candidates.push(trimOptionText(points[1].content));
    }
    if (points.length >= 3 && points[2].content) {
        candidates.push(trimOptionText(points[2].content));
    }

    // 用其他卡片的 core_point 作为干扰项
    const otherCards = cards.filter(c => c.id !== currentCard.id && c.core_point).slice(0, 3);
    otherCards.forEach(c => {
        candidates.push(trimOptionText(c.core_point));
    });

    const used = new Set([core]);
    return candidates
        .map((text) => trimOptionText(text))
        .filter((text) => text && text.length > 10 && !used.has(text) && (used.add(text), true))
        .slice(0, 3);
}

function buildQuizQuestion(card) {
    const correctAnswer = trimOptionText(getQuizPrompt(card));
    const distractors = getDistractorTexts(card);
    QUIZ_FALLBACK_OPTIONS.forEach((text) => {
        if (distractors.length >= 3) return;
        if (!text || text === correctAnswer || distractors.includes(text)) return;
        distractors.push(text);
    });
    const options = shuffleArray([correctAnswer, ...distractors]).slice(0, 4);
    const labels = ['A', 'B', 'C', 'D'];

    return {
        card,
        question: '以下哪项最符合这张卡片的主要观点？',
        correctAnswer,
        options: options.map((text, index) => ({
            label: labels[index] || String(index + 1),
            text,
            correct: text === correctAnswer
        }))
    };
}

function launchQuizCelebration() {
    els.quizConfettiLayer.innerHTML = '';
    const colors = ['#f6c453', '#7c5cff', '#4f8cff', '#52c26d', '#ff7a59'];
    for (let i = 0; i < 18; i++) {
        const piece = document.createElement('span');
        piece.className = 'quiz-confetti';
        piece.style.left = `${8 + Math.random() * 84}%`;
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = `${Math.random() * 0.15}s`;
        piece.style.setProperty('--confetti-x', `${(Math.random() - 0.5) * 140}px`);
        piece.style.setProperty('--confetti-r', `${Math.random() * 320 - 160}deg`);
        els.quizConfettiLayer.appendChild(piece);
    }
    window.setTimeout(() => {
        els.quizConfettiLayer.innerHTML = '';
    }, 1100);
}

function showKnowledgePower() {
    els.quizPowerFloat.classList.remove('show');
    void els.quizPowerFloat.offsetWidth;
    els.quizPowerFloat.classList.add('show');
}

function updateQuizStatusText() {
    const stats = loadReviewStats();
    els.quizStreakText.textContent = `🔥 连续打卡 ${stats.streakDays} 天`;
    els.quizScoreText.textContent = `答对 ${quizCorrect} 题`;
}

function renderQuizQuestion() {
    if (quizIndex >= quizQueue.length) {
        completeQuizReview();
        return;
    }

    currentQuizQuestion = buildQuizQuestion(quizQueue[quizIndex]);
    quizLocked = false;
    els.swipeDone.classList.add('hidden');
    els.quizStage.classList.remove('hidden');
    els.quizCardTitle.textContent = currentQuizQuestion.card.title || '知识卡片';
    els.quizQuestion.textContent = currentQuizQuestion.question;
    els.quizProgress.textContent = `${quizIndex + 1} / ${quizQueue.length}`;
    els.quizFeedback.classList.add('hidden');
    els.quizFeedback.textContent = '';
    updateQuizStatusText();
    els.quizOptions.innerHTML = currentQuizQuestion.options.map((option, index) => `
        <button type="button" class="quiz-option" data-option-index="${index}">
            <span class="quiz-option-label">${option.label}</span>
            <span class="quiz-option-text">${escapeHTML(option.text)}</span>
        </button>
    `).join('');

    els.quizOptions.querySelectorAll('.quiz-option').forEach((button) => {
        button.addEventListener('click', () => handleQuizAnswer(Number(button.dataset.optionIndex)));
    });
}

function startQuizMode() {
    window.clearTimeout(quizTransitionTimer);
    const prioritizedIds = [
        ...activeReviewIds.filter((id) => swipeReviewResults[id] === 'confused'),
        ...activeReviewIds.filter((id) => swipeReviewResults[id] === 'understood')
    ];

    quizQueue = prioritizedIds.map(getCardById).filter(Boolean).slice(0, 3);
    if (quizQueue.length === 0) {
        closeSwipeReview();
        return;
    }

    quizIndex = 0;
    quizCorrect = 0;
    quizWrong = 0;
    els.quizComplete.classList.add('hidden');
    renderQuizQuestion();
}

function handleQuizAnswer(optionIndex) {
    if (quizLocked || !currentQuizQuestion) return;
    quizLocked = true;

    const selected = currentQuizQuestion.options[optionIndex];
    const buttons = Array.from(els.quizOptions.querySelectorAll('.quiz-option'));
    buttons.forEach((button, index) => {
        const option = currentQuizQuestion.options[index];
        button.disabled = true;
        if (option.correct) {
            button.classList.add('is-correct');
        }
    });

    if (selected?.correct) {
        quizCorrect++;
        buttons[optionIndex]?.classList.add('is-correct');
        els.quizFeedback.textContent = '回答正确，知识力 +1';
        els.quizFeedback.className = 'quiz-feedback';
        launchQuizCelebration();
        showKnowledgePower();
    } else {
        quizWrong++;
        buttons[optionIndex]?.classList.add('is-wrong');
        els.quizFeedback.textContent = `答错了，正确答案：${currentQuizQuestion.correctAnswer}`;
        els.quizFeedback.className = 'quiz-feedback is-wrong';
    }

    els.quizFeedback.classList.remove('hidden');
    updateQuizStatusText();
    window.setTimeout(() => {
        quizIndex++;
        renderQuizQuestion();
    }, selected?.correct ? 1100 : 3000);
}

function updateReviewStreak(correctCount) {
    const stats = loadReviewStats();
    const today = todayKey();
    if (stats.lastCheckInDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = yesterday.toISOString().split('T')[0];
        stats.streakDays = stats.lastCheckInDate === yesterdayKey ? stats.streakDays + 1 : 1;
        stats.lastCheckInDate = today;
        stats.totalSessions += 1;
    }
    stats.knowledgePower += correctCount;
    saveReviewStats(stats);
    return stats;
}

function completeQuizReview() {
    const stats = updateReviewStreak(quizCorrect);
    activeReviewIds.forEach((id) => {
        const card = getCardById(id);
        if (!card) return;
        card.reviewed_on = todayKey();
        card.last_reviewed_at = new Date().toISOString();
    });
    saveCards();

    reviewSession = ensureDailyReviewSession();
    reviewSession.completed = true;
    reviewSession.completedAt = new Date().toISOString();
    reviewSession.correctCount = quizCorrect;
    reviewSession.wrongCount = quizWrong;
    saveReviewSession(reviewSession);

    els.quizStage.classList.add('hidden');
    els.quizComplete.classList.remove('hidden');
    els.quizCompleteTitle.textContent = '恭喜您已经完成本次打卡';
    els.quizCompleteCopy.textContent = `进度环已更新，连续打卡 ${stats.streakDays} 天，明天会继续从已读卡片中抽取。`;
    els.quizCompleteCorrect.textContent = String(quizCorrect);
    els.quizCompleteWrong.textContent = String(quizWrong);
    els.quizCompleteStreak.textContent = String(stats.streakDays);
    applyReviewStats();
}

function bindSwipeReviewGestures() {
    const scene = els.swipeScene;
    const card = els.swipeCard;
    const arrowL = els.swipeArrowLeft;
    const arrowR = els.swipeArrowRight;
    let startX = 0, startY = 0, dx = 0, dragging = false;
    let dirLock = null;

    scene.addEventListener('pointerdown', (e) => {
        if (!swipeReviewQueue.length || els.quizStage.classList.contains('hidden') === false) return;
        startX = e.clientX;
        startY = e.clientY;
        dx = 0;
        dragging = true;
        dirLock = null;
        card.style.transition = 'none';
        scene.setPointerCapture?.(e.pointerId);
    });

    scene.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dirLock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            dirLock = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        }
        if (dirLock === 'v') return;
        e.preventDefault();

        const rotate = dx * 0.04;
        const fade = 1 - Math.abs(dx) / 500;
        card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
        card.style.opacity = Math.max(0.5, fade);

        // 箭头提示
        const progress = Math.min(1, Math.abs(dx) / 80);
        if (dx < -20) {
            arrowL.style.opacity = progress;
            arrowR.style.opacity = '0';
            card.classList.add('swiping-left');
            card.classList.remove('swiping-right');
        } else if (dx > 20) {
            arrowR.style.opacity = progress;
            arrowL.style.opacity = '0';
            card.classList.add('swiping-right');
            card.classList.remove('swiping-left');
        } else {
            arrowL.style.opacity = '0';
            arrowR.style.opacity = '0';
            card.classList.remove('swiping-left', 'swiping-right');
        }
    });

    scene.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        arrowL.style.opacity = '0';
        arrowR.style.opacity = '0';
        card.classList.remove('swiping-left', 'swiping-right');

        if (dx < -60) {
            handleSwipeDecision('understood');
        } else if (dx > 60) {
            handleSwipeDecision('confused');
        } else {
            card.style.transition = 'transform 0.35s cubic-bezier(0.2,0.8,0.3,1), opacity 0.35s ease';
            card.style.transform = '';
            card.style.opacity = '1';
        }
    });

    scene.addEventListener('pointercancel', () => {
        dragging = false;
        arrowL.style.opacity = '0';
        arrowR.style.opacity = '0';
        card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        card.style.transform = '';
        card.style.opacity = '1';
        card.classList.remove('swiping-left', 'swiping-right');
    });
}

function getSameCategoryCards(card) {
    return cards.filter(item =>
        item.id !== card.id &&
        item.category === card.category &&
        !item.is_integrated &&
        !item.is_todo
    );
}

// 打开卡片详情
function openCardDetail(card, editMode = false) {
    currentViewCardId = card.id;
    isEditingCard = editMode;
    normalizeCard(card);
    
    let contentHtml = '';
    
    if (editMode) {
        contentHtml = renderCardEditForm(card);
    } else
    if (card.is_integrated) {
        contentHtml = `
            <span class="detail-badge">${MERGED_CATEGORY}</span>
            <h2 class="detail-title" ${styleAttr(card, 'title')}>${renderMarkedField(card, 'title')}</h2>
            <div class="detail-section">
                <h4>主要观点</h4>
                <p ${styleAttr(card, 'core_point')}>${renderMarkedField(card, 'core_point', card.summary || '')}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <div ${styleAttr(card, 'key_points')}>
                    ${renderDetailPoints(card.key_points, card.marks?.key_points)}
                </div>
            </div>
            ${renderSourceLink(card)}
            ${safeList(card.sourceCards).length ? `
            <div class="detail-section">
                <h4>来源卡片</h4>
                <p>${safeList(card.source_titles).length
                    ? safeList(card.source_titles).map((title) => escapeHTML(title)).join('、')
                    : safeList(card.sourceCards).map((id) => escapeHTML(id)).join('、')}</p>
            </div>` : ''}
            ${card.note ? renderNoteSection(card.note, card) : ''}
        `;
    } else {
        // 普通卡片/待办卡片布局
        contentHtml = `
            <span class="detail-badge">${escapeHTML(card.category)}</span>
            <h2 class="detail-title" ${styleAttr(card, 'title')}>${renderMarkedField(card, 'title')}</h2>
            <div class="detail-section">
                <h4>主要观点</h4>
                <p ${styleAttr(card, 'core_point')}>${renderMarkedField(card, 'core_point')}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <div ${styleAttr(card, 'key_points')}>
                    ${renderDetailPoints(card.key_points, card.marks?.key_points)}
                </div>
            </div>
            ${renderSourceLink(card)}
            ${card.note ? renderNoteSection(card.note, card) : ''}
        `;
    }
    
    els.modalBody.innerHTML = contentHtml;
    bindDetailPointToggles();
    if (editMode) {
        bindEditStyleControls();
    }
    
    // Get it 按钮控制
    if (card.is_todo) {
        els.btnAddTodo.classList.add('hidden');
    } else {
        els.btnAddTodo.classList.remove('hidden');
        els.btnAddTodo.innerHTML = card.isRead
            ? '<i data-lucide="check-circle"></i> 已读'
            : '<i data-lucide="sparkles"></i> Get it';
        els.btnAddTodo.classList.toggle('is-got', !!card.isRead);
    }

    els.btnEditCard.classList.toggle('hidden', editMode);
    els.btnSaveCard.classList.toggle('hidden', !editMode);
    els.btnCancelEdit.classList.toggle('hidden', !editMode);
    els.btnDeleteCard.classList.toggle('hidden', editMode);
    els.btnAddTodo.classList.toggle('hidden', editMode || card.is_todo);
    
    els.cardModal.classList.remove('hidden');
    refreshIcons();
}

function bindDetailPointToggles() {
    els.modalBody.querySelectorAll('[data-point-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const item = button.closest('.detail-point-item');
            if (!item) return;
            const isOpen = item.classList.toggle('is-open');
            button.setAttribute('aria-expanded', String(isOpen));
        });
    });
}

function renderCardEditForm(card) {
    normalizeCard(card);
    pendingEditMarks = {
        title: normalizeMarkRanges(card.marks?.title),
        core_point: normalizeMarkRanges(card.marks?.core_point),
        key_points: normalizeMarkRanges(card.marks?.key_points),
        note: normalizeMarkRanges(card.marks?.note)
    };
    const presetCategories = ['生活', '职场', '学习', '娱乐', '财经', '健康', '科技'];
    const allCategories = [...new Set([...presetCategories, ...getUserCategories().filter((c) => c !== '全部' && c !== '整合' && c !== '默认')])];
    const categoryChips = allCategories
        .map((c) => `<button type="button" class="category-option${c === (card.category || '') ? ' is-active' : ''}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`)
        .join('');
    return `
        <div class="edit-form">
            <div class="edit-form-head">
                <span class="detail-badge">编辑内容</span>
                <h2>整理这张知识卡</h2>
                <p>改动会保存在本地卡片库里，关键要点建议一行写一个。</p>
            </div>
            <div class="edit-field-grid">
                ${renderEditField('title', '标题', 'input', card.title, card, { placeholder: '给这张卡片起一个清楚的标题' })}
                <div class="editable-field" data-field="category">
                    <span>领域</span>
                    <div class="category-select-wrap" id="edit-category-wrap">
                        <button type="button" class="category-select-trigger" id="edit-category-trigger">
                            <span id="edit-category-display">${escapeHTML(card.category || '选择领域')}</span>
                            <i data-lucide="chevron-down"></i>
                        </button>
                        <div class="category-dropdown hidden" id="edit-category-dropdown">
                            <div class="category-dropdown-title">常用分类</div>
                            <div class="category-option-grid">
                                ${categoryChips}
                            </div>
                            <div class="category-dropdown-custom">
                                <input id="edit-category-custom" type="text" placeholder="新建自定义分类" maxlength="10">
                                <button type="button" class="category-custom-btn" id="btn-confirm-custom-category">确定</button>
                            </div>
                        </div>
                    </div>
                    <input id="edit-category" type="hidden" value="${escapeHTML(card.category || '')}">
                </div>
            </div>
            ${renderEditField('core_point', '主要观点', 'textarea', card.core_point || card.summary || '', card, { placeholder: '用一句话写清这张卡最重要的观点' })}
            ${renderEditField('key_points', '关键要点', 'textarea', safeList(card.key_points).map((point, index) => pointPlainText(point, index)).join('\n'), card, { placeholder: '每行一个要点', helper: '保存后会自动整理成要点列表。' })}
            ${renderEditField('note', '自由补充', 'textarea', card.note || '', card, { placeholder: '补充你的理解、例子或后续行动' })}
            <label class="editable-field" data-field="video_link">
                <span>原视频链接</span>
                <input id="edit-link" value="${escapeHTML(card.video_link || '')}" placeholder="https://...">
            </label>
            <section class="edit-ai-panel" aria-label="AI补充">
                <div>
                    <strong>AI补充</strong>
                    <p>基于当前标题和内容生成相关补充条目，勾选后添加到自由补充。</p>
                </div>
                <button type="button" class="btn btn-secondary" id="btn-ai-supplement">
                    <i data-lucide="sparkles"></i>
                    生成补充
                </button>
                <div class="ai-supplement-results hidden" id="ai-supplement-results"></div>
            </section>
            <div class="selection-mark-toolbar hidden" id="selection-mark-toolbar">
                <button type="button" class="mark-color-dot mark-red" data-mark-color="red" aria-label="红色标记"></button>
                <button type="button" class="mark-color-dot mark-yellow" data-mark-color="yellow" aria-label="黄色标记"></button>
                <button type="button" class="mark-color-dot mark-green" data-mark-color="green" aria-label="绿色标记"></button>
                <button type="button" class="mark-color-dot mark-blue" data-mark-color="blue" aria-label="蓝色标记"></button>
                <button type="button" class="mark-clear" data-mark-color="clear" aria-label="清除颜色">无</button>
            </div>
            <div class="precision-mark-picker hidden" id="precision-mark-picker"></div>
        </div>
    `;
}

function renderEditField(field, label, type, value, card, options = {}) {
    const styles = card.customStyles[field] || TEXT_STYLE_DEFAULTS[field];
    const controlId = `edit-${field}`;
    const editFontSize = styles.fontSize || '16px';
    const placeholder = options.placeholder || '';
    const cleanValue = stripInlineMarks(value);
    const control = `<div id="${controlId}" class="edit-rich-field ${type === 'textarea' ? 'is-multiline' : ''}" data-style-field="${field}" data-placeholder="${escapeHTML(placeholder)}" contenteditable="true" role="textbox" style="font-size:${editFontSize};color:${escapeHTML(styles.color)};font-weight:${escapeHTML(styles.fontWeight || '400')};font-style:${escapeHTML(styles.fontStyle || 'normal')};text-decoration:${escapeHTML(styles.textDecoration || 'none')}">${renderEditableHtml(cleanValue, pendingEditMarks[field])}</div>`;

    return `
        <label class="editable-field" data-field="${field}">
            <span>${escapeHTML(label)}</span>
            ${control}
            ${options.helper ? `<small>${escapeHTML(options.helper)}</small>` : ''}
        </label>
    `;
}

function bindEditStyleControls() {
    els.modalBody.querySelectorAll('[data-style-field]').forEach((input) => {
        input.addEventListener('focus', () => {
            activeEditField = input.dataset.styleField;
            updateSelectionMarkToolbar(input);
        });
        input.addEventListener('click', () => {
            activeEditField = input.dataset.styleField;
            updateSelectionMarkToolbar(input);
        });
        input.addEventListener('mouseup', () => updateSelectionMarkToolbar(input));
        input.addEventListener('touchend', () => window.setTimeout(() => updateSelectionMarkToolbar(input), 80));
        input.addEventListener('keyup', () => updateSelectionMarkToolbar(input));
        input.addEventListener('select', () => updateSelectionMarkToolbar(input));
        input.addEventListener('input', () => {
            pendingEditMarks[input.dataset.styleField] = getEditableMarkRanges(input);
            updateSelectionMarkToolbar(input);
        });
    });

    const categoryTrigger = document.getElementById('edit-category-trigger');
    const categoryDropdown = document.getElementById('edit-category-dropdown');
    if (categoryTrigger && categoryDropdown) {
        categoryTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            categoryDropdown.classList.toggle('hidden');
        });
        categoryDropdown.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            const option = event.target.closest('.category-option');
            if (!option) return;
            categoryDropdown.querySelectorAll('.category-option').forEach((c) => c.classList.remove('is-active'));
            option.classList.add('is-active');
            document.getElementById('edit-category').value = option.dataset.category;
            document.getElementById('edit-category-display').textContent = option.dataset.category;
            categoryDropdown.classList.add('hidden');
        });
    }

    const customCategoryInput = document.getElementById('edit-category-custom');
    const customCategoryBtn = document.getElementById('btn-confirm-custom-category');
    if (customCategoryInput) {
        customCategoryInput.addEventListener('click', (e) => e.stopPropagation());
        const confirmCustomCategory = () => {
            const val = customCategoryInput.value.trim();
            if (!val) return;
            document.getElementById('edit-category').value = val;
            document.getElementById('edit-category-display').textContent = val;
            if (categoryDropdown) categoryDropdown.querySelectorAll('.category-option').forEach((c) => c.classList.remove('is-active'));
            if (categoryDropdown) categoryDropdown.classList.add('hidden');
            customCategoryInput.value = '';
        };
        customCategoryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmCustomCategory(); }
        });
        if (customCategoryBtn) {
            customCategoryBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmCustomCategory(); });
        }
    }

    // 点击空白区域关闭下拉和颜色工具栏
    els.modalBody.addEventListener('click', () => {
        if (categoryDropdown && !categoryDropdown.classList.contains('hidden')) {
            categoryDropdown.classList.add('hidden');
        }
        const toolbar = document.getElementById('selection-mark-toolbar');
        if (toolbar && !toolbar.classList.contains('hidden')) {
            toolbar.classList.add('hidden');
        }
    });

    const aiButton = document.getElementById('btn-ai-supplement');
    if (aiButton) {
        aiButton.addEventListener('click', handleAiSupplement);
    }

    const markToolbar = document.getElementById('selection-mark-toolbar');
    if (markToolbar) {
        markToolbar.addEventListener('click', (event) => {
            event.stopPropagation();
            const button = event.target.closest('[data-mark-color]');
            if (!button) return;
            markSelectedEditText(button.dataset.markColor || 'red');
        });
    }

    const precisionPicker = document.getElementById('precision-mark-picker');
    if (precisionPicker) {
        precisionPicker.addEventListener('click', handlePrecisionMarkPick);
        precisionPicker.addEventListener('pointerdown', handlePrecisionMarkPointerDown);
        precisionPicker.addEventListener('pointermove', handlePrecisionMarkPointerMove);
        precisionPicker.addEventListener('pointerup', handlePrecisionMarkPointerUp);
        precisionPicker.addEventListener('pointercancel', closePrecisionMarkDrag);
    }

    const aiResults = document.getElementById('ai-supplement-results');
    if (aiResults) {
        aiResults.addEventListener('click', (event) => {
            const addButton = event.target.closest('[data-ai-add-selected]');
            if (!addButton) return;
            addSelectedAiSupplements();
        });
    }
}

function updateSelectionMarkToolbar(input = null) {
    const toolbar = document.getElementById('selection-mark-toolbar');
    if (!toolbar) return;
    const activeInput = input || els.modalBody.querySelector(`[data-style-field="${activeEditField}"]`);
    if (!activeInput) {
        toolbar.classList.add('hidden');
        return;
    }

    const field = activeInput.closest('.editable-field');
    if (!field) {
        toolbar.classList.add('hidden');
        return;
    }

    const offsets = getSelectionOffsetsWithin(activeInput);
    const hasSelection = offsets && !offsets.collapsed;
    if (!hasSelection) {
        toolbar.classList.add('hidden');
        return;
    }

    const selectionRect = getSelectionRectWithin(activeInput);
    const fieldRect = field.getBoundingClientRect();
    const bodyRect = els.modalBody.getBoundingClientRect();
    const toolbarLeft = selectionRect
        ? selectionRect.left - bodyRect.left + Math.max(0, (selectionRect.width - 156) / 2)
        : fieldRect.left - bodyRect.left + 12;
    // 放在选区下方，避免与系统剪切/复制菜单重叠
    const toolbarTop = selectionRect
        ? selectionRect.bottom - bodyRect.top + 8 + els.modalBody.scrollTop
        : fieldRect.bottom - bodyRect.top + 6 + els.modalBody.scrollTop;
    toolbar.style.left = `${Math.max(8, Math.min(toolbarLeft, bodyRect.width - 178))}px`;
    toolbar.style.top = `${Math.max(8, toolbarTop)}px`;
    toolbar.classList.toggle('is-line-mode', !hasSelection);
    toolbar.classList.remove('hidden');
}

function closePrecisionMarkPicker() {
    const picker = document.getElementById('precision-mark-picker');
    if (picker) {
        picker.classList.add('hidden');
        picker.innerHTML = '';
    }
    precisionMarkState = null;
    precisionMarkDrag = null;
}

function openPrecisionMarkPicker(input, color, cursorIndex) {
    const picker = document.getElementById('precision-mark-picker');
    if (!picker) return;
    const value = getEditablePlainText(input);
    const lineStart = value.lastIndexOf('\n', Math.max(0, cursorIndex - 1)) + 1;
    const nextBreak = value.indexOf('\n', cursorIndex);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lineText = value.slice(lineStart, lineEnd);
    if (!lineText.trim()) return;

    precisionMarkState = {
        field: activeEditField,
        color,
        lineStart,
        lineEnd,
        startIndex: null
    };

    const field = input.closest('.editable-field');
    const fieldRect = field.getBoundingClientRect();
    const bodyRect = els.modalBody.getBoundingClientRect();
    picker.style.left = `${Math.max(12, fieldRect.left - bodyRect.left + 12)}px`;
    picker.style.top = `${fieldRect.bottom - bodyRect.top + 48 + els.modalBody.scrollTop}px`;
    picker.innerHTML = `
        <div class="precision-mark-head">
            <span>按住滑动选择文字</span>
            <button type="button" data-precision-cancel>取消</button>
        </div>
        <div class="precision-mark-chars">
            ${[...lineText].map((char, index) => `
                <button type="button" data-precision-index="${index}">${escapeHTML(char === ' ' ? '·' : char)}</button>
            `).join('')}
        </div>
    `;
    picker.classList.remove('hidden');
}

function handlePrecisionMarkPick(event) {
    const picker = document.getElementById('precision-mark-picker');
    if (!picker || !precisionMarkState) return;
    if (event.target.closest('[data-precision-cancel]')) {
        closePrecisionMarkPicker();
        return;
    }
    if (precisionMarkDrag?.moved) return;

    const charButton = event.target.closest('[data-precision-index]');
    if (!charButton) return;
    const index = Number(charButton.dataset.precisionIndex);
    if (Number.isNaN(index)) return;

    if (precisionMarkState.startIndex === null) {
        precisionMarkState.startIndex = index;
        picker.querySelectorAll('[data-precision-index]').forEach((button) => button.classList.remove('is-start'));
        charButton.classList.add('is-start');
        return;
    }

    const input = els.modalBody.querySelector(`[data-style-field="${precisionMarkState.field}"]`);
    if (!input) {
        closePrecisionMarkPicker();
        return;
    }

    const startOffset = Math.min(precisionMarkState.startIndex, index);
    const endOffset = Math.max(precisionMarkState.startIndex, index) + 1;
    const start = precisionMarkState.lineStart + startOffset;
    const end = precisionMarkState.lineStart + endOffset;
    input.focus();
    setEditableSelection(input, start, end);
    markSelectedEditText(precisionMarkState.color);
    closePrecisionMarkPicker();
}

function getPrecisionButtonFromPoint(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element?.closest?.('[data-precision-index]');
}

function paintPrecisionRange(startIndex, endIndex) {
    const picker = document.getElementById('precision-mark-picker');
    if (!picker) return;
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    picker.querySelectorAll('[data-precision-index]').forEach((button) => {
        const index = Number(button.dataset.precisionIndex);
        button.classList.toggle('is-selected', index >= start && index <= end);
        button.classList.toggle('is-start', index === startIndex);
    });
}

function handlePrecisionMarkPointerDown(event) {
    const charButton = event.target.closest('[data-precision-index]');
    if (!charButton || !precisionMarkState) return;
    event.preventDefault();
    const index = Number(charButton.dataset.precisionIndex);
    precisionMarkDrag = {
        pointerId: event.pointerId,
        startIndex: index,
        endIndex: index,
        moved: false
    };
    charButton.setPointerCapture?.(event.pointerId);
    paintPrecisionRange(index, index);
}

function handlePrecisionMarkPointerMove(event) {
    if (!precisionMarkDrag || precisionMarkDrag.pointerId !== event.pointerId) return;
    const charButton = getPrecisionButtonFromPoint(event);
    if (!charButton) return;
    const index = Number(charButton.dataset.precisionIndex);
    if (Number.isNaN(index)) return;
    if (index !== precisionMarkDrag.endIndex) precisionMarkDrag.moved = true;
    precisionMarkDrag.endIndex = index;
    paintPrecisionRange(precisionMarkDrag.startIndex, precisionMarkDrag.endIndex);
}

function handlePrecisionMarkPointerUp(event) {
    if (!precisionMarkDrag || precisionMarkDrag.pointerId !== event.pointerId || !precisionMarkState) return;
    const drag = precisionMarkDrag;
    precisionMarkDrag = null;
    const input = els.modalBody.querySelector(`[data-style-field="${precisionMarkState.field}"]`);
    if (!input) {
        closePrecisionMarkPicker();
        return;
    }

    const startOffset = Math.min(drag.startIndex, drag.endIndex);
    const endOffset = Math.max(drag.startIndex, drag.endIndex) + 1;
    const start = precisionMarkState.lineStart + startOffset;
    const end = precisionMarkState.lineStart + endOffset;
    input.focus();
    setEditableSelection(input, start, end);
    markSelectedEditText(precisionMarkState.color);
    closePrecisionMarkPicker();
}

function closePrecisionMarkDrag() {
    precisionMarkDrag = null;
}

function markSelectedEditText(color = 'red') {
    const input = els.modalBody.querySelector(`[data-style-field="${activeEditField}"]`);
    if (!input) return;
    const offsets = getSelectionOffsetsWithin(input);
    if (!offsets) return;
    let start = offsets.start;
    let end = offsets.end;

    if (start === end) {
        const isTouchLayout = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
        if (isTouchLayout && color !== 'clear') {
            openPrecisionMarkPicker(input, color, start);
            return;
        }
        const value = getEditablePlainText(input);
        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const nextBreak = value.indexOf('\n', start);
        const lineEnd = nextBreak === -1 ? value.length : nextBreak;
        start = lineStart;
        end = lineEnd;
        if (start === end) {
            input.focus();
            return;
        }
    }

    const field = input.dataset.styleField;
    pendingEditMarks[field] = normalizeMarkRanges(pendingEditMarks[field]);

    if (color === 'clear') {
        pendingEditMarks[field] = pendingEditMarks[field].flatMap((range) => {
            if (range.end <= start || range.start >= end) return [range];
            const kept = [];
            if (range.start < start) {
                kept.push({ ...range, end: start });
            }
            if (range.end > end) {
                kept.push({ ...range, start: end });
            }
            return kept;
        });
    } else {
        pendingEditMarks[field] = [
            ...pendingEditMarks[field].filter((range) => range.end <= start || range.start >= end),
            { start, end, color }
        ].sort((a, b) => a.start - b.start);
    }

    rerenderEditableField(input, start, end);
    input.focus();
    updateSelectionMarkToolbar(input);
}

function getCurrentEditDraft() {
    return {
        title: getEditablePlainText(document.getElementById('edit-title')).trim() || '',
        category: document.getElementById('edit-category')?.value.trim() || '',
        core_point: getEditablePlainText(document.getElementById('edit-core_point')).trim() || '',
        key_points: getEditablePlainText(document.getElementById('edit-key_points')).trim() || '',
        note: getEditablePlainText(document.getElementById('edit-note')).trim() || ''
    };
}

function buildAiSupplementPrompt(draft) {
    return `你是知识卡片编辑助手。请基于用户正在编辑的卡片，为每个关键要点补充一条延伸理解或背景知识。

要求：
1. 只输出 JSON 对象，不要 Markdown。
2. 不要编造具体平台检索结果、链接或实时新闻。
3. 每条补充必须明确对应原卡片的一个关键要点，用 target_point 字段标注对应的要点标题。
4. 补充内容是对该要点的延伸理解、背景知识或实际应用建议，不能重复原文。
5. 输出 3-5 条，每条 30-80 个中文字符。
6. 每条包含 target_point、title 和 content。

返回格式：
{"supplements":[{"target_point":"对应要点标题","title":"补充标题","content":"补充内容"}]}

当前卡片：
标题：${draft.title}
领域：${draft.category}
主要观点：${draft.core_point}
关键要点：${draft.key_points}
已有补充：${draft.note}`;
}

function normalizeAiSupplements(result) {
    const rawList = Array.isArray(result?.supplements)
        ? result.supplements
        : Array.isArray(result?.items)
            ? result.items
            : [];
    return rawList
        .map((item, index) => {
            if (typeof item === 'string') {
                return { title: `补充 ${index + 1}`, content: item.trim(), target_point: '' };
            }
            return {
                target_point: String(item?.target_point || item?.targetPoint || '').trim(),
                title: String(item?.title || item?.heading || `补充 ${index + 1}`).trim(),
                content: String(item?.content || item?.text || item?.summary || '').trim()
            };
        })
        .filter((item) => item.content)
        .slice(0, 6);
}

async function handleAiSupplement() {
    const button = document.getElementById('btn-ai-supplement');
    const resultsEl = document.getElementById('ai-supplement-results');
    if (!button || !resultsEl) return;

    const draft = getCurrentEditDraft();
    if (!draft.title && !draft.core_point && !draft.key_points) {
        resultsEl.classList.remove('hidden');
        resultsEl.innerHTML = '<p class="ai-supplement-empty">先写一点标题或主要观点，AI 才能补充得更准。</p>';
        return;
    }

    button.disabled = true;
    button.innerHTML = '<span class="spinner mini-spinner"></span> 生成中';
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<p class="ai-supplement-empty">正在整理相关补充...</p>';

    try {
        const result = await callDeepSeek(buildAiSupplementPrompt(draft));
        const supplements = normalizeAiSupplements(result);
        if (!supplements.length) {
            throw new Error('AI 没有返回可用补充条目');
        }
        resultsEl.innerHTML = `
            <div class="ai-supplement-list">
                ${supplements.map((item, index) => `
                    <label class="ai-supplement-item">
                        <input type="checkbox" data-ai-supplement-item value="${index}">
                        <span>
                            ${item.target_point ? `<small class="ai-supplement-target">→ ${escapeHTML(item.target_point)}</small>` : ''}
                            <strong>${escapeHTML(item.title)}</strong>
                            <em>${escapeHTML(item.content)}</em>
                        </span>
                    </label>
                `).join('')}
            </div>
            <button type="button" class="btn btn-primary ai-supplement-add" data-ai-add-selected>添加选中</button>
        `;
        resultsEl.dataset.supplements = JSON.stringify(supplements);
    } catch (error) {
        resultsEl.innerHTML = `<p class="ai-supplement-empty">生成失败：${escapeHTML(error.message || '请稍后重试')}</p>`;
    } finally {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="sparkles"></i> 重新生成';
        refreshIcons();
    }
}

function addSelectedAiSupplements() {
    const resultsEl = document.getElementById('ai-supplement-results');
    const noteInput = document.getElementById('edit-note');
    if (!resultsEl || !noteInput) return;

    const supplements = JSON.parse(resultsEl.dataset.supplements || '[]');
    const selected = [...resultsEl.querySelectorAll('[data-ai-supplement-item]:checked')]
        .map((input) => supplements[Number(input.value)])
        .filter(Boolean);

    if (!selected.length) {
        resultsEl.querySelector('.ai-supplement-add')?.classList.add('shake-once');
        window.setTimeout(() => resultsEl.querySelector('.ai-supplement-add')?.classList.remove('shake-once'), 320);
        return;
    }

    const addition = selected
        .map((item) => item.target_point
            ? `- 【${item.target_point}】${item.title}：${item.content}`
            : `- ${item.title}：${item.content}`)
        .join('\n');
    const existing = getEditablePlainText(noteInput).trim();
    noteInput.innerHTML = escapeHTML(existing
        ? `${existing}\n\nAI补充：\n${addition}`
        : `AI补充：\n${addition}`).replace(/\n/g, '<br>');
    noteInput.dispatchEvent(new Event('input'));
    noteInput.focus();

    resultsEl.dataset.supplements = '';
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    const aiButton = document.getElementById('btn-ai-supplement');
    if (aiButton) {
        aiButton.innerHTML = '<i data-lucide="sparkles"></i> 重新生成';
    }
    refreshIcons();
}

function renderNoteSection(note, card = null) {
    return `
        <div class="detail-section note-section">
            <h4>记事本内容</h4>
            <p ${card ? styleAttr(card, 'note') : ''}>${card ? renderMarkedField(card, 'note') : renderMultilineText(note)}</p>
        </div>
    `;
}

function saveEditedCard() {
    const card = cards.find(c => c.id === currentViewCardId);
    if (!card) return;
    normalizeCard(card);
    const titleInput = document.getElementById('edit-title');
    const coreInput = document.getElementById('edit-core_point');
    const pointsInput = document.getElementById('edit-key_points');
    const noteInput = document.getElementById('edit-note');
    card.title = stripInlineMarks(getEditablePlainText(titleInput)).trim() || card.title;
    card.category = normalizeCategory(document.getElementById('edit-category').value);
    if (card.category !== MERGED_CATEGORY && (card.isIntegrated || card.is_integrated)) {
        card.isIntegrated = false;
        card.is_integrated = false;
    }
    card.core_point = stripInlineMarks(getEditablePlainText(coreInput)).trim();
    card.key_points = stripInlineMarks(getEditablePlainText(pointsInput)).split('\n').map(p => p.trim()).filter(Boolean);
    card.quote = card.quote || '';
    card.action = card.action || '';
    card.note = stripInlineMarks(getEditablePlainText(noteInput)).trim();
    card.video_link = document.getElementById('edit-link').value.trim();
    card.marks = {
        title: getEditableMarkRanges(titleInput).filter((range) => range.end <= card.title.length),
        core_point: getEditableMarkRanges(coreInput).filter((range) => range.end <= card.core_point.length),
        key_points: getEditableMarkRanges(pointsInput).filter((range) => range.end <= getEditablePlainText(pointsInput).length),
        note: getEditableMarkRanges(noteInput).filter((range) => range.end <= card.note.length)
    };
    els.modalBody.querySelectorAll('[data-style-field]').forEach((input) => {
        const field = input.dataset.styleField;
        card.customStyles[field] = {
            fontSize: input.style.fontSize || TEXT_STYLE_DEFAULTS[field]?.fontSize || '16px',
            color: input.style.color || TEXT_STYLE_DEFAULTS[field]?.color || '#1f1f1d',
            fontWeight: input.style.fontWeight || '400',
            fontStyle: input.style.fontStyle || 'normal',
            textDecoration: input.style.textDecoration || 'none'
        };
    });
    saveCards();
    renderCategoryNav();
    renderCards();
    renderDailyReview();
    openCardDetail(card, false);
}

function openNotebook() {
    const card = cards.find(c => c.id === currentViewCardId);
    if (!card) return;
    els.notebookInput.value = card.note || '';
    els.notebookModal.classList.remove('hidden');
}

function saveNotebook() {
    const card = cards.find(c => c.id === currentViewCardId);
    if (!card) return;
    card.note = els.notebookInput.value.trim();
    saveCards();
    els.notebookModal.classList.add('hidden');
    openCardDetail(card, false);
}

// Get it：加入复习池
function handleGetCard() {
    const sourceCard = cards.find(c => c.id === currentViewCardId);
    if (!sourceCard) return;
    normalizeCard(sourceCard);
    const nextRead = !sourceCard.isRead;
    sourceCard.isRead = nextRead;
    sourceCard.readAt = nextRead ? new Date().toISOString() : '';
    saveCards();
    if (nextRead) {
        includeCardInTodayReviewSession(sourceCard.id);
        playGetAnimation();
        els.btnAddTodo.innerHTML = '<i data-lucide="check-circle"></i> 已读';
        els.btnAddTodo.classList.add('is-got');
        if (window.lucide) lucide.createIcons({ nodes: [els.btnAddTodo] });
        window.setTimeout(() => {
            closeCardModal();
            renderCategoryNav();
            renderCards();
            renderDailyReview();
        }, 600);
    } else {
        els.btnAddTodo.innerHTML = '<i data-lucide="sparkles"></i> Get it';
        els.btnAddTodo.classList.remove('is-got');
        if (window.lucide) lucide.createIcons({ nodes: [els.btnAddTodo] });
        renderCategoryNav();
        renderCards();
        renderDailyReview();
        openCardDetail(sourceCard, false);
    }
}

function playGetAnimation() {
    const target = els.reviewHeading || document.querySelector('[data-mobile-action="home"]') || els.btnAddTodo;
    const start = els.btnAddTodo.getBoundingClientRect();
    const end = target?.getBoundingClientRect();
    if (!end) {
        els.btnAddTodo.classList.add('get-pulse');
        window.setTimeout(() => els.btnAddTodo.classList.remove('get-pulse'), 520);
        return;
    }
    const flyer = document.createElement('div');
    flyer.className = 'get-flyer';
    flyer.textContent = '⭐';
    flyer.style.left = `${start.left + start.width / 2}px`;
    flyer.style.top = `${start.top + start.height / 2}px`;
    flyer.style.setProperty('--fly-x', `${end.left + end.width / 2 - start.left - start.width / 2}px`);
    flyer.style.setProperty('--fly-y', `${end.top + end.height / 2 - start.top - start.height / 2}px`);
    document.body.appendChild(flyer);
    window.setTimeout(() => flyer.remove(), 720);
}

// 调用 API 辅助函数
async function callDeepSeek(prompt) {
    console.log('[Zcard] callDeepSeek 开始');
    const directBody = JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
    });

    // 带超时的 fetch 封装
    const fetchWithTimeout = (url, options, timeoutMs = 30000) => {
        return Promise.race([
            fetch(url, options),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`请求超时 (${timeoutMs}ms)`)), timeoutMs)
            )
        ]);
    };

    // 1. 先尝试代理
    try {
        console.log('[Zcard] 尝试代理请求...');
        const proxyRes = await fetchWithTimeout(PROXY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        }, 35000);
        console.log('[Zcard] 代理响应状态:', proxyRes.status);
        if (proxyRes.ok) {
            const data = await proxyRes.json();
            console.log('[Zcard] 代理返回数据:', JSON.stringify(data).substring(0, 100));
            const content = data?.content || data?.choices?.[0]?.message?.content;
            if (content) return parseAIContent(content);
        } else {
            const errData = await proxyRes.json().catch(() => ({}));
            console.warn('[Zcard] 代理返回错误:', errData.error || proxyRes.status);
        }
    } catch (e) {
        console.warn('[Zcard] 代理请求失败:', e.message);
    }

    // 2. 代理失败，回退到前端直连
    if (API_KEY) {
        const directRes = await fetchWithTimeout(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${API_KEY}`
            },
            body: directBody
        }, 30000);
        if (!directRes.ok) {
            const err = await directRes.json().catch(() => ({}));
            const msg = err?.error
                || (directRes.status === 401 ? 'API Key 无效或已过期'
                    : directRes.status === 429 ? 'API 请求过于频繁'
                    : `DeepSeek API 返回 ${directRes.status}`);
            throw new Error(msg);
        }
        const data = await directRes.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) return parseAIContent(content);
        throw new Error('AI 返回内容为空');
    }

    throw new Error('未检测到后端代理。请运行 server.js，或在设置里填写 API Key');
}

function parseAIContent(content) {
    content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    console.log('[Zcard] AI 原始返回内容:', content);
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    const candidates = [
        content,
        start >= 0 && end > start ? content.slice(start, end + 1) : '',
        content.replace(/,\s*([}\]])/g, '$1')
    ].filter(Boolean);

    let lastError;
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch (e) {
            lastError = e;
        }
    }
    console.error('[Zcard] JSON 解析失败:', lastError?.message);
    throw new Error('AI 返回的内容不是有效 JSON: ' + content.substring(0, 100));
}

function createLocalCard(text, videoLink = '') {
    const cleanedText = cleanSharedText(text);
    const source = cleanedText || text.trim();
    const sentences = source
        .split(/[。！？!?；;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const firstSentence = sentences[0] || source || '这条内容值得整理成知识卡片';
    const title = firstSentence.slice(0, 12) || '知识摘录';
    const keyPoints = sentences.slice(0, 3);

    while (keyPoints.length < 3) {
        keyPoints.push([
            '保留核心观点，方便之后复习',
            '把内容转成可执行的行动提醒',
            '后续可接入 API 获得更完整总结'
        ][keyPoints.length]);
    }

    return {
        title,
        core_point: firstSentence.slice(0, 80),
        key_points: keyPoints.map((point) => point.slice(0, 80)),
        quote: firstSentence.slice(0, 60),
        action: '',
        category: DEFAULT_CATEGORY,
        video_link: videoLink,
        is_local: true,
        isRead: false,
        readAt: '',
        isFavorite: false,
        customStyles: {}
    };
}

function cleanSharedText(text) {
    let cleaned = String(text || '');
    try {
        cleaned = decodeURIComponent(cleaned);
    } catch {
        // Some shared links contain partial percent-encoding. Keep the original text.
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

async function callExtractCard(input) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    let res;
    try {
        res = await fetch(EXTRACT_CARD_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input }),
            signal: controller.signal
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `内容提取接口返回 ${res.status}`);
    }
    return data;
}

function resetGenerateState() {
    if (els.loadingIndicator) {
        els.loadingIndicator.classList.add('hidden');
    }
    if (els.btnGenerate) {
        els.btnGenerate.disabled = false;
    }
}

function showAppNotice(title, message, buttonText = '知道了') {
    const oldNotice = document.querySelector('.app-notice');
    if (oldNotice) oldNotice.remove();

    const notice = document.createElement('div');
    notice.className = 'app-notice';
    const lines = String(message || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    notice.innerHTML = `
        <div class="app-notice-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
            <button type="button" class="app-notice-close" aria-label="关闭">
                <i data-lucide="x"></i>
            </button>
            <div class="app-notice-kicker">提示</div>
            <h3>${escapeHTML(title)}</h3>
            <div class="app-notice-body">
                ${lines.map((line) => `<p>${escapeHTML(line)}</p>`).join('')}
            </div>
            <button type="button" class="app-notice-btn">${escapeHTML(buttonText)}</button>
        </div>
    `;
    document.body.appendChild(notice);
    refreshIcons();

    const closeNotice = () => notice.remove();
    notice.addEventListener('click', (event) => {
        if (event.target === notice) closeNotice();
    });
    notice.querySelector('.app-notice-close')?.addEventListener('click', closeNotice);
    notice.querySelector('.app-notice-btn')?.addEventListener('click', closeNotice);
}

function showNeedsTextMessage(extracted) {
    showAppNotice('需要补充视频文字', [
        extracted?.reason || '暂时无法只通过链接提取视频完整文字。',
        '',
        '请粘贴视频字幕、转录文本或较完整的视频文案后再生成。'
    ].join('\n'));
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

function getContentQualityWarning(originalText, cleanedText, linkMatches) {
    const hasLink = linkMatches.length > 0;
    const hasEnoughContent = hasEnoughVideoContent(cleanedText);
    if (hasEnoughContent) return '';

    if (hasLink) {
        return [
            '当前只检测到视频链接或很短的分享文案，暂时不能生成正式卡片。',
            '',
            '为了避免卡片内容和视频实际内容不符，请粘贴视频字幕、转录文本或较完整的视频文案后再生成。',
            '后续会接入抖音链接解析/转写能力，实现只贴链接自动提取。'
        ].join('\n');
    }

    return [
        '当前输入内容太短，可能不足以准确提炼视频观点。',
        '',
        '请粘贴更完整的视频文案、字幕或转录文本后再生成。'
    ].join('\n');
}

// 生成卡片
async function handleGenerateCard() {
    console.log('[Zcard] handleGenerateCard 被调用');
    let text = els.videoInput.value.trim();
    if (!text) {
        alert('请先输入视频文案或链接');
        return;
    }
    console.log('[Zcard] 输入内容:', text.substring(0, 50));
    
    // 提取所有可能的链接（支持多个链接）
    const linkMatches = text.match(/https?:\/\/[^\s]+/g) || [];
    const videoLink = linkMatches.length > 0 ? linkMatches[0] : ''; // 记录第一个作为主要来源
    
    els.loadingIndicator.classList.remove('hidden');
    els.btnGenerate.disabled = true;
    console.log('[Zcard] loading 显示完毕');

    const originalInput = text;
    const cleanedInput = cleanSharedText(text);
    console.log('[Zcard] 文本清洗完毕, 长度:', cleanedInput.length);

    // 显示分步进度
    if (linkMatches.length) {
        els.loadingIndicator.querySelector('span').textContent = '正在解析视频链接...';
        setTimeout(() => {
            els.loadingIndicator.querySelector('span').textContent = '正在提取字幕文字...';
        }, 1000);
        setTimeout(() => {
            els.loadingIndicator.querySelector('span').textContent = '正在生成知识卡片...';
        }, 3000);
    } else {
        els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    }

    let prompt = "";
    let result;
    try {
        console.log('[Zcard] 尝试 extract-card 接口...');
        const extracted = await callExtractCard(originalInput);
        if (extracted.status === 'needs_text') {
            resetGenerateState();
            showNeedsTextMessage(extracted);
            return;
        }
        if (extracted.status === 'needs_ai_key') {
            resetGenerateState();
            showAppNotice('缺少 AI 配置', [
                extracted.reason || '已提取到视频文字，但缺少 AI Key，暂时无法生成卡片。',
                '',
                '请在 .env 中填写 DEEPSEEK_API_KEY 后重启服务。'
            ].join('\n'));
            return;
        }
        if (extracted.status === 'ok' && extracted.card) {
            result = {
                ...extracted.card,
                source_type: extracted.source_type,
                source_text_length: extracted.source_text_length
            };
        }
    } catch (error) {
        console.warn('[Zcard] extract-card 接口不可用，回退到前端总结链路:', error.message);
        if (error.message && error.message.includes('缺少 DEEPSEEK_API_KEY')) {
            resetGenerateState();
            showAppNotice('生成失败', error.message || '内容提取接口处理失败');
            return;
        }
    }

    if (!result) {
        const contentWarning = getContentQualityWarning(originalInput, cleanedInput, linkMatches);
        if (contentWarning) {
            resetGenerateState();
            showAppNotice('需要补充视频文字', contentWarning);
            return;
        }
        text = cleanedInput;

        // 如果文本中包含多个链接以及对应说明文字，我们将其视为多源融合输入
        if (linkMatches.length > 1) {
            // 多源融合 Prompt
            prompt = `你是一个知识整合专家。用户提供了多个信息源的内容，请将它们融合成一张知识卡片。严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式。

返回格式：
{“title”: “综合提炼的标题（10字以内）”, “core_point”: “主要观点（一句话总结共性）”, “key_points”: [{“heading”:”小标题”,”content”:”详细说明”}], “quote”: “”, “action”: “”, “category”: “${DEFAULT_CATEGORY}”}

字段要求：
1. 所有字段必须使用中文。
2. key_points 返回 3-5 个对象，根据实际信息量决定。
3. 只能基于提供的原文总结，不能自行补充或推测。
4. quote、action 固定返回空字符串，category 固定返回”${DEFAULT_CATEGORY}”。

原文内容：
${text}`;
        } else {
            // 单内容 Prompt — 根据是否有链接决定措辞
            const hasLink = videoLink.length > 0;
            const roleName = hasLink ? '内容分析专家' : '知识卡片整理助手';
            const label = hasLink ? '以下是从视频中提取的内容' : '以下内容';
            prompt = `你是一个${roleName}。请对${label}进行结构化总结，严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式：

{“title”: “标题（10字以内）”, “core_point”: “主要观点”, “key_points”: [{“heading”:”小标题”,”content”:”详细说明”}], “quote”: “”, “action”: “”, “category”: “${DEFAULT_CATEGORY}”}

字段要求：
1. 所有字段必须使用中文。
2. key_points 根据原文信息量生成 2-5 个对象，信息少就少生成，不要凑数。
3. 只能基于提供的原文总结，绝对不能自行补充或推测原文没有的内容。
4. 不要使用”视频展示了””视频中”等措辞，直接陈述内容本身。
5. quote、action 固定返回空字符串，category 固定返回”${DEFAULT_CATEGORY}”。

原文：
${text}`;
        }

        try {
            els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
            console.log('[Zcard] 开始调用 API...');
            result = await callDeepSeek(prompt);
            console.log('[Zcard] API 调用成功:', JSON.stringify(result).substring(0, 80));
        } catch (error) {
            console.warn('[Zcard] AI 调用失败，已使用本地演示模式生成卡片。', error);
            result = createLocalCard(text, videoLink);
        }
    }
        
    const newCard = {
        id: 'card_' + Date.now(),
        ...result,
        video_link: result.video_link || videoLink,
        category: normalizeCategory(result.category),
        created_at: new Date().toISOString().split('T')[0],
        is_todo: false,
        is_integrated: false,
        isRead: false,
        readAt: '',
        isFavorite: false,
        customStyles: {}
    };

    cards.unshift(newCard);
    saveCards();

    els.videoInput.value = '';
    currentView = 'home';
    currentCategory = '全部';
    currentSearch = '';
    els.searchInput.value = '';
    els.btnClearSearch.classList.add('hidden');
    closeSearchResults();
    document.querySelectorAll('[data-mobile-action]').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === 'home');
    });
    renderCategoryNav();
    const composeSection = document.getElementById('compose-section');
    if (composeSection) {
        composeSection.style.display = '';
    }
    renderCards();
    renderDailyReview();
    focusGeneratedCard(newCard.id);
    
    if (result.is_local) {
        alert('未检测到可用 API，已使用本地演示模式生成卡片。');
    }

    try {
        refreshIcons();
    } finally {
        els.loadingIndicator.classList.add('hidden');
        els.btnGenerate.disabled = false;
    }
}

function normalizeIntegratedResult(result, selectedCardsData, category) {
    const fallbackCategory = normalizeCategory(category);
    const normalized = {
        title: String(result?.title || '').trim(),
        core_point: String(result?.core_point || result?.summary || '').trim(),
        key_points: safeList(result?.key_points).map((item, index) => normalizeKeyPoint(item, index)).filter((item) => item.heading && item.content),
        quote: '',
        action: '',
        category: normalizeCategory(result?.category || fallbackCategory),
        sourceCards: selectedCardsData.map((card) => card.id)
    };

    if (!normalized.title || !normalized.core_point || normalized.key_points.length < 3) {
        return createLocalIntegratedCard(selectedCardsData, category);
    }

    return normalized;
}

function createLocalIntegratedCard(selectedCardsData, category) {
    const selectedIds = selectedCardsData.map((card) => card.id).sort();
    const isRequiredDemoPair = REQUIRED_DEMO_CARD_IDS.every((id) => selectedIds.includes(id)) && selectedIds.length === REQUIRED_DEMO_CARD_IDS.length;
    if (isRequiredDemoPair) {
        return {
            title: '华谊兄弟兴衰始末',
            core_point: '华谊兄弟因战略失误、管理混乱，7年累计亏损82亿，最终走向破产。',
            key_points: [
                '盲目投资扩张，忽视主营业务',
                '内部管理混乱，缺乏有效监督',
                '对市场变化反应迟钝，错失转型机会',
                '7年累计亏损82亿元，被正式申请破产',
                '折射影视行业整体寒冬'
            ],
            quote: '',
            action: '',
            category: normalizeCategory(category),
            sourceCards: [...REQUIRED_DEMO_CARD_IDS]
        };
    }

    const mergedPoints = [...new Map(selectedCardsData
        .flatMap((card) => safeList(card.key_points).map((point, index) => normalizeKeyPoint(point, index)))
        .filter((point) => point.heading && point.content)
        .map((point) => [pointHeading(point, 0), point])).values()]
        .slice(0, 5);
    while (mergedPoints.length < 4) {
        const fallbackHeadings = ['背景脉络', '共同结论', '差异视角', '复盘价值'];
        const fallbackContents = ['补充事件背景，串起前因后果。', '合并重复信息，提炼关键节点。', '从不同卡片中保留差异视角，避免只剩单一结论。', '把碎片信息整理成一张后续可复用的完整卡片。'];
        mergedPoints.push({
            heading: fallbackHeadings[mergedPoints.length] || '整合价值',
            content: fallbackContents[mergedPoints.length] || '提炼共同信息，形成一张完整卡片。'
        });
    }
    const corePoints = [...new Set(selectedCardsData.map((card) => card.core_point || card.summary).filter(Boolean))];
    const categories = [...new Set(selectedCardsData.map((card) => normalizeCategory(card.category)).filter((item) => item !== DEFAULT_CATEGORY))];

    return {
        title: `${selectedCardsData[0]?.title?.slice(0, 8) || '知识'}整合`,
        core_point: corePoints.join('；').slice(0, 120) || '这组卡片反映的是同一主题下的多维信息，需要合并理解。',
        key_points: mergedPoints,
        quote: '',
        action: '',
        category: normalizeCategory(category || categories[0] || DEFAULT_CATEGORY),
        sourceCards: selectedCardsData.map((card) => card.id)
    };
}

function isRequiredDemoSelection(selectedCardsData) {
    const selectedIds = selectedCardsData.map((card) => card.id).sort();
    return REQUIRED_DEMO_CARD_IDS.every((id) => selectedIds.includes(id)) && selectedIds.length === REQUIRED_DEMO_CARD_IDS.length;
}

function showIntegratePreview(result, selectedCardsData, category, copyText) {
    const sourceLinks = [...new Set(selectedCardsData.map((card) => sourceVideoUrl(card.video_link)).filter(Boolean))];
    pendingIntegrateResult = {
        result,
        selectedIds: new Set(selectedCards),
        category,
        selectedCardsData
    };

    els.integratePreviewTitle.textContent = result.title || '整合结果';
    els.integratePreviewBody.innerHTML = `
        <div class="preview-card">
            <span class="card-badge">${escapeHTML(result.category || category)}</span>
            <h3>${escapeHTML(result.title || '无标题')}</h3>
            <p>${escapeHTML(result.core_point || '')}</p>
            ${safeList(result.key_points).length ? `<ul>${safeList(result.key_points).map((point, index) => `<li>${escapeHTML(pointPlainText(point, index))}</li>`).join('')}</ul>` : ''}
        </div>
        ${sourceLinks.length ? `
            <div class="preview-source-links">
                <h4>原视频链接</h4>
                ${sourceLinks.map((link, index) => `<a href="${escapeHTML(link)}" target="_blank" rel="noopener">来源${index + 1}：${escapeHTML(link)}</a>`).join('')}
            </div>
        ` : ''}
        <div class="source-cards-info">${escapeHTML(copyText)}</div>
    `;
    els.integratePreviewModal.classList.remove('hidden');
    refreshIcons();
}

// 整合卡片 —— 第一步：调 AI 并预览
async function handleIntegrateCards() {
    if (selectedCards.size < 2) return;

    const selectedCardsData = cards
        .filter((card) => selectedCards.has(card.id))
        .map((card) => normalizeCard(card));
    const targetCategory = MERGED_CATEGORY;

    if (isRequiredDemoSelection(selectedCardsData)) {
        const result = createLocalIntegratedCard(selectedCardsData, targetCategory);
        showIntegratePreview(result, selectedCardsData, targetCategory, `将整合 ${selectedCardsData.length} 张演示卡片，确认后原小卡片会被移除。`);
        return;
    }

    const combinedContent = selectedCardsData.map((card, index) => `卡片${index + 1}
标题：${card.title}
分类：${card.category || DEFAULT_CATEGORY}
核心观点：${card.core_point || card.summary || ''}
关键要点：${safeList(card.key_points).map((point, idx) => pointPlainText(point, idx)).join('；')}
原视频链接：${sourceVideoUrl(card.video_link) || '无'}`).join('\n\n');

    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您整合多重视角...';
    els.loadingIndicator.classList.remove('hidden');

    const prompt = `你是一个知识整合专家。以下是用户自由选择的多张知识卡片，可能来自不同领域。请整合成一张更完整、更有概括力的大卡片。

要求：
1. 只返回 JSON，不要返回任何其他文字，不要使用 markdown。
2. 标题控制在 8-14 个字，能概括所有来源卡片的共同主题。
3. core_point 用 70-120 字，总结这些卡片合并后的核心观点。
4. key_points 返回 4 到 6 条，每条是对象 {"heading":"小标题","content":"详细说明"}。
5. key_points 要去重、归纳、合并，不要简单拼接原卡片。
6. heading 必须是有内容的概括性小标题，例如“内在稳定”“外部奖惩”“决策边界”，不要写“要点1”“要点2”。
7. 每条 content 控制在 60-120 字，适合作为知识卡片正文。
8. quote 和 action 固定返回空字符串。
9. category 固定返回“${MERGED_CATEGORY}”。

返回格式：
{"title":"整合标题","core_point":"主要观点","key_points":[{"heading":"小标题","content":"详细说明"}],"quote":"","action":"","category":"${MERGED_CATEGORY}"}

卡片内容：
${combinedContent}`;

    try {
        const aiResult = await callDeepSeek(prompt);
        const result = normalizeIntegratedResult(aiResult, selectedCardsData, targetCategory);
        showIntegratePreview(result, selectedCardsData, targetCategory, `将整合 ${selectedCardsData.length} 张卡片，确认后原小卡片会被移除。`);

    } catch (e) {
        console.warn('[Zcard] AI 整合失败，已回退本地整合结果。', e);
        const result = createLocalIntegratedCard(selectedCardsData, targetCategory);
        showIntegratePreview(result, selectedCardsData, targetCategory, 'AI 不可用，已生成本地整合预览；确认后仍会生成整合卡片。');
    } finally {
        els.loadingIndicator.classList.add('hidden');
        els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    }
}

// 整合预览 —— 确认
function confirmIntegrate() {
    if (!pendingIntegrateResult) return;
    const { result, selectedIds, category } = pendingIntegrateResult;
    const normalizedPoints = safeList(result.key_points)
        .map((point, index) => normalizeKeyPoint(point, index))
        .filter((point) => point.heading && point.content);

    const validSourceCards = cards.filter((card) => selectedIds.has(card.id));
    if (validSourceCards.length === 0) {
        alert('源卡片已被删除，无法完成整合。');
        pendingIntegrateResult = null;
        return;
    }
    const integratedCard = {
        id: 'int_' + Date.now(),
        title: result.title,
        core_point: result.core_point,
        summary: result.core_point,
        key_points: normalizedPoints,
        quote: result.quote || '',
        action: result.action || '',
        category: MERGED_CATEGORY,
        created_at: new Date().toISOString().split('T')[0],
        is_todo: false,
        isIntegrated: true,
        is_integrated: true,
        isRead: false,
        readAt: '',
        isFavorite: false,
        isDemo: false,
        customStyles: {},
        sourceCards: validSourceCards.map((card) => card.id),
        source_titles: validSourceCards.map((card) => card.title).filter(Boolean),
        source_links: validSourceCards.map((card) => sourceVideoUrl(card.video_link)).filter(Boolean)
    };

    cards = cards.filter((card) => !selectedIds.has(card.id));
    cards.unshift(normalizeCard(integratedCard));
    saveCards();

    selectedCards.clear();
    pendingIntegrateResult = null;
    updateBatchActions();
    renderCategoryNav();
    renderCards();
    renderDailyReview();
    els.integratePreviewModal.classList.add('hidden');
}

// 整合预览 —— 取消
function closeIntegratePreview() {
    pendingIntegrateResult = null;
    els.integratePreviewModal.classList.add('hidden');
}

// 复习闪卡模式
function startFlashcardMode() {
    // 底部复习固定从全部已读卡片中抽取，不受当前筛选影响。
    flashcardQueue = cards.filter(c => c.isRead);

    if (flashcardQueue.length === 0) {
        alert('还没有已读卡片，去详情页点击 Get it 吧！');
        return;
    }
    
    currentFlashcardIndex = 0;
    els.flashcardModal.classList.remove('hidden');
    renderCurrentFlashcard();
}

function renderCurrentFlashcard() {
    if (currentFlashcardIndex >= flashcardQueue.length) {
        alert('复习完成！');
        els.flashcardModal.classList.add('hidden');
        return;
    }
    
    const card = flashcardQueue[currentFlashcardIndex];
    els.fcProgress.textContent = `${currentFlashcardIndex + 1} / ${flashcardQueue.length}`;
    
    els.flashcardElement.classList.remove('is-flipped');
    els.fcActions.classList.add('hidden');
    
    // 填充内容
    els.fcCategory.textContent = card.category;
    els.fcTitle.textContent = card.title;
    els.fcCore.textContent = card.core_point;
    els.fcPoints.innerHTML = safeList(card.key_points).map((point, index) => `<li>${escapeHTML(pointPlainText(point, index))}</li>`).join('');
}

function nextFlashcard(remembered) {
    if (remembered) {
        // 记住了，进入下一张
        currentFlashcardIndex++;
    } else {
        // 没记住，放到队尾重新复习
        const card = flashcardQueue.splice(currentFlashcardIndex, 1)[0];
        flashcardQueue.push(card);
    }
    
    // 加点小延迟让翻转动画自然点
    setTimeout(() => {
        renderCurrentFlashcard();
    }, 300);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function wrapCanvasText(ctx, text, maxWidth) {
    const content = String(text || '').trim();
    if (!content) return [];
    const lines = [];
    let current = '';
    for (const char of content) {
        const next = current + char;
        if (ctx.measureText(next).width <= maxWidth || !current) {
            current = next;
        } else {
            lines.push(current);
            current = char;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function measureExportCardHeight(ctx, card, cardWidth, styles) {
    const innerWidth = cardWidth - styles.cardPadding * 2;
    const titleLines = wrapCanvasText(ctx, card.title, innerWidth);
    ctx.font = styles.coreFont;
    const coreLines = wrapCanvasText(ctx, card.core_point || card.summary || '', innerWidth);
    ctx.font = styles.pointFont;
    const pointLines = safeList(card.key_points).flatMap((point) => wrapCanvasText(ctx, `• ${point}`, innerWidth - 8));
    ctx.font = styles.noteFont;
    const sourceLines = card.video_link ? wrapCanvasText(ctx, `原视频：${card.video_link}`, innerWidth) : [];

    return (
        styles.cardPadding +
        styles.pillHeight +
        18 +
        titleLines.length * styles.titleLineHeight +
        12 +
        coreLines.length * styles.coreLineHeight +
        (pointLines.length ? 18 + pointLines.length * styles.pointLineHeight : 0) +
        (sourceLines.length ? 18 + sourceLines.length * styles.noteLineHeight : 0) +
        styles.cardPadding
    );
}

function drawExportTextBlock(ctx, lines, x, y, lineHeight, color) {
    ctx.fillStyle = color;
    lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * lineHeight);
    });
    return y + lines.length * lineHeight;
}

function buildExportCanvas(selectedCardsData) {
    const width = 1200;
    const padding = 56;
    const gap = 28;
    const styles = {
        cardPadding: 32,
        pillHeight: 36,
        titleFont: '700 40px "Microsoft YaHei", "PingFang SC", sans-serif',
        titleLineHeight: 52,
        coreFont: '400 26px "Microsoft YaHei", "PingFang SC", sans-serif',
        coreLineHeight: 40,
        pointFont: '400 24px "Microsoft YaHei", "PingFang SC", sans-serif',
        pointLineHeight: 36,
        noteFont: '400 22px "Microsoft YaHei", "PingFang SC", sans-serif',
        noteLineHeight: 34
    };

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    if (!measureCtx) {
        throw new Error('浏览器不支持 Canvas 导出');
    }

    const cardWidth = width - padding * 2;
    let totalHeight = 210;
    selectedCardsData.forEach((card) => {
        measureCtx.font = styles.titleFont;
        totalHeight += measureExportCardHeight(measureCtx, normalizeCard(card), cardWidth, styles) + gap;
    });
    totalHeight += 80;

    const dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法创建导出画布');
    }

    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, totalHeight);

    ctx.fillStyle = '#2563eb';
    ctx.font = '700 42px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Zcard 知识卡片', width / 2, 76);
    ctx.fillStyle = '#64748b';
    ctx.font = '400 24px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText('让每一条视频都变成你的知识', width / 2, 118);

    let y = 160;
    ctx.textAlign = 'left';

    selectedCardsData.forEach((rawCard) => {
        const card = normalizeCard(rawCard);
        const cardHeight = measureExportCardHeight(measureCtx, card, cardWidth, styles);

        ctx.save();
        drawRoundedRect(ctx, padding, y, cardWidth, cardHeight, 28);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#e2e8f0';
        ctx.stroke();
        ctx.restore();

        let cursorY = y + styles.cardPadding;
        const cursorX = padding + styles.cardPadding;
        const innerWidth = cardWidth - styles.cardPadding * 2;
        const pillText = card.category || DEFAULT_CATEGORY;
        const pillWidth = Math.max(120, Math.ceil(measureCtx.measureText(pillText).width) + 28);

        drawRoundedRect(ctx, cursorX, cursorY, pillWidth, styles.pillHeight, 999);
        ctx.fillStyle = '#eff6ff';
        ctx.fill();
        ctx.fillStyle = '#2563eb';
        ctx.font = '700 18px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.fillText(pillText, cursorX + 14, cursorY + 24);
        cursorY += styles.pillHeight + 18;

        ctx.fillStyle = '#0f172a';
        ctx.font = styles.titleFont;
        const titleLines = wrapCanvasText(ctx, card.title, innerWidth);
        cursorY = drawExportTextBlock(ctx, titleLines, cursorX, cursorY + 8, styles.titleLineHeight, '#0f172a');

        ctx.font = styles.coreFont;
        const coreLines = wrapCanvasText(ctx, card.core_point || card.summary || '', innerWidth);
        cursorY = drawExportTextBlock(ctx, coreLines, cursorX, cursorY + 4, styles.coreLineHeight, '#334155');

        ctx.font = styles.pointFont;
        const pointTexts = safeList(card.key_points).map((point, index) => `• ${pointPlainText(point, index)}`);
        if (pointTexts.length) {
            cursorY += 14;
            pointTexts.forEach((pointText) => {
                const lines = wrapCanvasText(ctx, pointText, innerWidth - 8);
                cursorY = drawExportTextBlock(ctx, lines, cursorX, cursorY + 10, styles.pointLineHeight, '#475569');
            });
        }

        ctx.font = styles.noteFont;
        if (card.video_link) {
            const sourceLines = wrapCanvasText(ctx, `原视频：${card.video_link}`, innerWidth);
            cursorY = drawExportTextBlock(ctx, sourceLines, cursorX, cursorY + 16, styles.noteLineHeight, '#1d4ed8');
        }

        y += cardHeight + gap;
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 18px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Generated by Zcard', width / 2, totalHeight - 36);

    return canvas;
}

async function downloadCanvasImage(canvas, filename) {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
    if (!blob) {
        throw new Error('图片编码失败，请稍后重试');
    }

    const objectUrl = URL.createObjectURL(blob);
    if (isIOS) {
        const previewTab = window.open(objectUrl, '_blank', 'noopener');
        if (!previewTab) {
            throw new Error('请允许浏览器打开新窗口后重试');
        }
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        alert('图片已在新窗口打开，请长按或保存到相册。');
        return;
    }

    const link = document.createElement('a');
    link.download = filename;
    link.href = objectUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// 导出图片
async function handleExportImages() {
    if (selectedCards.size === 0) {
        alert('请先勾选要导出的卡片。');
        return;
    }

    const selectedCardsData = cards
        .filter((card) => selectedCards.has(card.id))
        .map((card) => normalizeCard(card));

    try {
        const canvas = buildExportCanvas(selectedCardsData);
        await downloadCanvasImage(canvas, `知识卡片导出_${Date.now()}.png`);
    } catch (e) {
        console.error('导出失败:', e);
        alert(`导出图片失败：${e.message || '未知错误'}`);
    } finally {
        selectedCards.clear();
        updateBatchActions();
        renderCards();
    }
}

// 辅助函数
function saveCards() {
    if (!storageAvailable) {
        console.log('[Zcard] 卡片保存在内存中（刷新页面会丢失，因为 localStorage 不可用）');
        return;
    }
    try {
        localStorage.setItem('douyin_cards', JSON.stringify(cards));
    } catch (error) {
        console.error('保存卡片失败:', error);
        // 尝试清理旧数据后重试
        try {
            localStorage.removeItem('douyin_review_session');
            localStorage.removeItem('douyin_review_stats');
            localStorage.setItem('douyin_cards', JSON.stringify(cards));
        } catch (retryError) {
            alert('存储空间不足，部分数据可能未保存。建议导出重要卡片后清理浏览器数据。');
        }
    }
}

// 启动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
