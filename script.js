/**
 * 抖音知识卡片 - 核心逻辑 (script.js)
 */

// 全局状态
let cards = [];
let currentCategory = '全部';
let currentSearch = '';
let currentView = 'home'; // home | unread | read | favorites
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
let API_KEY = sessionStorage.getItem('deepseek_api_key') || '';
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

function safeList(items) {
    return Array.isArray(items) ? items : [];
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
    const categories = ['生活', '职场', '学习', '娱乐', '财经', '健康', '科技'];
    if (categories.includes(raw)) return raw;
    const lower = raw.toLowerCase();
    const map = {
        life: '生活',
        work: '职场',
        career: '职场',
        study: '学习',
        education: '学习',
        learning: '学习',
        entertainment: '娱乐',
        finance: '财经',
        health: '健康',
        technology: '科技',
        tech: '科技'
    };
    return map[lower] || '学习';
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
    const stored = loadStoredJson(REVIEW_SETTINGS_KEY, {});
    return {
        cardCount: clamp(stored.cardCount || 3, 3, 5)
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
    els.integratePreviewModal = document.getElementById('integrate-preview-modal');
    els.btnCloseIntegratePreview = document.getElementById('btn-close-integrate-preview');
    els.integratePreviewTitle = document.getElementById('integrate-preview-title');
    els.integratePreviewBody = document.getElementById('integrate-preview-body');
    els.btnCancelIntegrate = document.getElementById('btn-cancel-integrate');
    els.btnConfirmIntegrate = document.getElementById('btn-confirm-integrate');
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

// 绑定事件
function bindEvents() {
    // 生成卡片
    els.btnGenerate.addEventListener('click', handleGenerateCard);
    
    // 分类点击 (领域内搜索)
    els.categoryList.addEventListener('click', (e) => {
        const btn = e.target.closest('.category-tag');
        if (!btn) return;
        
        // 更新激活状态
        document.querySelectorAll('.category-tag').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        
        currentCategory = btn.dataset.category;
        
        // 更新搜索框提示
        els.searchInput.placeholder = `在【${currentCategory}】中搜索...`;
        
        renderCards();
    });
    
    // 搜索
    els.searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.trim().toLowerCase();
        els.btnClearSearch.classList.toggle('hidden', !currentSearch);
        if (currentSearch) {
            showSearchResults(currentSearch);
        } else {
            closeSearchResults();
        }
    });
    els.btnClearSearch.addEventListener('click', () => {
        els.searchInput.value = '';
        currentSearch = '';
        els.btnClearSearch.classList.add('hidden');
        closeSearchResults();
    });
    els.btnCloseSearch.addEventListener('click', closeSearchResults);
    
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
    els.btnCloseModal.addEventListener('click', () => {
        els.cardModal.classList.add('hidden');
        currentViewCardId = null;
    });
    
    els.btnDeleteCard.addEventListener('click', () => {
        if (!currentViewCardId) return;
        if (confirm('确定要删除这张卡片吗？')) {
            cards = cards.filter(c => c.id !== currentViewCardId);
            saveCards();
            els.cardModal.classList.add('hidden');
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
        const card = cards.find(c => c.id === currentViewCardId);
        if (card) openCardDetail(card, false);
    });
    els.btnSaveCard.addEventListener('click', saveEditedCard);
    if (els.btnOpenNotebook) {
        els.btnOpenNotebook.addEventListener('click', openNotebook);
    }
    if (els.btnCloseNotebook) {
        els.btnCloseNotebook.addEventListener('click', () => els.notebookModal.classList.add('hidden'));
    }
    if (els.btnSaveNotebook) {
        els.btnSaveNotebook.addEventListener('click', saveNotebook);
    }

    // 整合预览弹窗
    els.btnCloseIntegratePreview.addEventListener('click', closeIntegratePreview);
    els.btnCancelIntegrate.addEventListener('click', closeIntegratePreview);
    els.btnConfirmIntegrate.addEventListener('click', confirmIntegrate);

    els.btnActionCancel.addEventListener('click', () => els.actionModal.classList.add('hidden'));
    els.btnActionDetail.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentActionCardId);
        els.actionModal.classList.add('hidden');
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

    // 点击今日复习卡片翻转
    els.reviewCard.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return; // 不拦截按钮点击
        if (reviewSession.completed || !currentReviewCardId) return;
        if (reviewCardFlipped) return;
        setReviewCardFlip(true);
    });

    // 滑动复习弹窗
    els.btnCloseSwipeReview.addEventListener('click', closeSwipeReview);
    els.btnSwipeDoneClose.addEventListener('click', startQuizMode);
    els.btnQuizCompleteClose.addEventListener('click', closeSwipeReview);
    els.btnSwipeUnderstood.addEventListener('click', () => handleSwipeDecision('understood'));
    els.btnSwipeConfused.addEventListener('click', () => handleSwipeDecision('confused'));
    bindSwipeReviewGestures();
    
    // 闪卡复习
    if (els.btnFlashcard) els.btnFlashcard.addEventListener('click', startFlashcardMode);
    els.btnCloseFlashcard.addEventListener('click', () => {
        els.flashcardModal.classList.add('hidden');
    });
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
    els.btnCloseSettings.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
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

    document.querySelectorAll('[data-mobile-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-mobile-action]').forEach((item) => item.classList.remove('active'));
            btn.classList.add('active');

            const action = btn.dataset.mobileAction;
            currentView = action;
            currentCategory = '全部';
            document.querySelectorAll('.category-tag').forEach(el => {
                el.classList.toggle('active', el.dataset.category === '全部');
            });
            els.searchInput.placeholder = '在【全部】中搜索...';

            // 输入区只在首页显示
            const composeSection = document.getElementById('compose-section');
            if (composeSection) {
                composeSection.style.display = action === 'home' ? '' : 'none';
            }

            renderCards();
            els.cardsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// 渲染卡片列表
function renderCards() {
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
        filtered = filtered.filter(c => c.category === currentCategory);
    }
    
    // 渲染
    els.cardsContainer.innerHTML = '';
    
    console.log('[Zcard] renderCards: 过滤后卡片数量:', filtered.length);
    
    if (filtered.length === 0) {
        console.log('[Zcard] 显示空状态');
        els.emptyState.classList.remove('hidden');
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
            ? `整合 · ${card.category || '未分类'}`
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
        card.core_point,
        card.summary,
        card.quote,
        card.action,
        ...safeList(card.key_points),
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
        : '<div class="empty-search">未找到相关卡片</div>';
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
                <span class="card-badge">${escapeHTML(card.category || '未分类')}</span>
                ${card.isFavorite ? '<span class="favorite-star" title="已收藏">⭐</span>' : ''}
            </div>
            <h3 class="card-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h3>
            <p class="card-core" ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point || card.summary || '')}</p>
        </article>
    `;
}

function updateCollectionTabState() {
    const collectTab = els.categoryList.querySelector('[data-category="收藏"]');
    if (!collectTab) return;
    const hasFavorite = cards.some(card => normalizeCard(card).isFavorite);
    collectTab.classList.toggle('has-favorites', hasFavorite);
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
    return cards.filter((card) => !card.is_todo);
}

function pickDailyReviewCards() {
    const candidates = getAllReviewCandidates();
    if (candidates.length === 0) return [];

    const preferred = shuffleArray(candidates.filter((card) => card.isRead));
    const fallback = shuffleArray(candidates.filter((card) => !card.isRead));
    return [...preferred, ...fallback].slice(0, Math.min(dailyReviewSettings.cardCount, candidates.length));
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
    return safeList(session.cardIds).filter((id) => !safeList(session.skippedIds).includes(id));
}

function getCardById(cardId) {
    return cards.find((card) => card.id === cardId) || null;
}

function includeCardInTodayReviewSession(cardId) {
    if (!cardId) return;
    reviewSession = ensureDailyReviewSession(cards.length > 0 ? false : true);

    const normalizedIds = safeList(reviewSession.cardIds).filter((id) => id !== cardId);
    reviewSession.cardIds = [cardId, ...normalizedIds];
    reviewSession.skippedIds = safeList(reviewSession.skippedIds).filter((id) => id !== cardId);
    reviewSession.completed = false;
    reviewSession.completedAt = '';
    reviewSession.correctCount = 0;
    reviewSession.wrongCount = 0;
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
    els.reviewPowerTotal.textContent = `知识力 ${stats.knowledgePower}`;
    return stats;
}

function resetReviewCardContent() {
    setReviewCardFlip(false);
    els.btnReviewDo.classList.remove('hidden');
    els.btnReviewSkip.classList.remove('hidden');
    els.reviewSection.classList.remove('hidden');
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
        els.reviewHeading.textContent = '进入复习';
        els.reviewSubtext.textContent = '先生成几张卡片，再来开启随机复习。';
        els.reviewMetaText.textContent = '随机复习';
        els.reviewBackMeta.textContent = '今日队列';
        els.reviewTitle.textContent = '还没有可复习卡片';
        els.reviewCore.textContent = '系统会从全部现有卡片中随机抽取 3 到 5 张作为今日复习队列。';
        els.reviewBackTitle.textContent = '暂无复习内容';
        els.reviewBackCore.textContent = '先生成卡片，再回来开启答题复习。';
        els.reviewHint.textContent = '生成卡片后，这里会自动出现今日随机复习入口。';
        els.reviewQueueLabel.textContent = '待复习 0 张';
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
        els.reviewHeading.textContent = '今日打卡完成';
        els.reviewSubtext.textContent = '恭喜您已经完成本次打卡，明天会自动刷新新的随机复习队列。';
        els.reviewMetaText.textContent = '今日已完成';
        els.reviewBackMeta.textContent = '完成状态';
        els.reviewTitle.textContent = '恭喜您已经完成本次打卡';
        els.reviewCore.textContent = `本轮答题答对 ${reviewSession.correctCount} 题，答错 ${reviewSession.wrongCount} 题，连续打卡 ${stats.streakDays} 天。`;
        els.reviewBackTitle.textContent = '随机复习已完成';
        els.reviewBackCore.textContent = '进度环已更新，明天会继续为你随机抽题。';
        els.reviewHint.textContent = '今日任务完成，继续保持连续打卡。';
        els.reviewQueueLabel.textContent = `今日完成 ${reviewSession.cardIds.length} 张`;
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        return;
    }

    if (!currentCard) {
        els.reviewHeading.textContent = '今日队列已清空';
        els.reviewSubtext.textContent = '当前随机队列已经处理完毕，你可以等待明天的新一轮复习。';
        els.reviewMetaText.textContent = '今日复习';
        els.reviewBackMeta.textContent = '今日队列';
        els.reviewTitle.textContent = '今天没有待处理卡片了';
        els.reviewCore.textContent = '你已经跳过或处理完今天抽到的全部卡片。';
        els.reviewBackTitle.textContent = '今日队列已清空';
        els.reviewBackCore.textContent = '明天会自动生成新的随机复习队列。';
        els.reviewHint.textContent = '今日队列处理完成。';
        els.reviewQueueLabel.textContent = '待复习 0 张';
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        return;
    }

    els.reviewHeading.textContent = '进入复习';
    els.reviewSubtext.textContent = `系统已从全部卡片中抽取 ${reviewSession.cardIds.length} 张，优先已读卡片，不足时自动补齐。`;
    els.reviewMetaText.textContent = `今日复习 · 剩余 ${queueCards.length} 张`;
    els.reviewBackMeta.textContent = `今日队列 · ${queueCards.length} 张`;
    els.reviewTitle.textContent = currentCard.title || '知识复习';
    els.reviewCore.textContent = currentCard.core_point || currentCard.summary || '点击翻转后开始今天的固定模板答题复习。';
    els.reviewBackTitle.textContent = currentCard.title || '开始今日复习';
    els.reviewBackCore.textContent = '先完成左滑右滑快速回忆，再进入核心观点选择题。';
    els.reviewHint.textContent = '点击卡片翻转，选择“开始复习”或“跳过这张”。';
    els.reviewQueueLabel.textContent = `待复习 ${queueCards.length} 张`;
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
        alert('今天的随机复习队列已经空了，明天会自动刷新新题。');
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
    quizTransitionTimer = window.setTimeout(() => {
        startQuizMode();
    }, 900);
}

function renderSwipeReviewCard() {
    if (swipeReviewIndex >= swipeReviewQueue.length) {
        finishSwipeReview();
        return;
    }
    const card = swipeReviewQueue[swipeReviewIndex];
    els.swipeProgress.textContent = `${swipeReviewIndex + 1} / ${swipeReviewQueue.length}`;
    els.srCategory.textContent = card.category || '未分类';
    els.srTitle.textContent = card.title || '';
    els.srCore.textContent = card.core_point || card.summary || '';
    els.srPoints.innerHTML = safeList(card.key_points).map(p => `<li>${escapeHTML(p)}</li>`).join('');
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

function getDistractorTexts(currentCard) {
    const distractors = [];
    const used = new Set([getQuizPrompt(currentCard)]);
    const otherCards = shuffleArray(cards.filter((card) => !card.is_todo && card.id !== currentCard.id));

    otherCards.forEach((card) => {
        [card.core_point, card.summary, ...safeList(card.key_points), card.action].forEach((value) => {
            const text = String(value || '').trim();
            if (!text || used.has(text) || distractors.length >= 3) return;
            used.add(text);
            distractors.push(text);
        });
    });

    return distractors.slice(0, 3);
}

function buildQuizQuestion(card) {
    const correctAnswer = getQuizPrompt(card);
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

    quizQueue = prioritizedIds.map(getCardById).filter(Boolean);
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
    }, selected?.correct ? 1100 : 1500);
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
    els.quizCompleteCopy.textContent = `进度环已更新，连续打卡 ${stats.streakDays} 天，明天会继续为你随机抽题。`;
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
            <span class="detail-badge">整合卡片 · ${escapeHTML(card.category || '未分类')}</span>
            <h2 class="detail-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h2>
            <div class="detail-section">
                <h4>核心观点</h4>
                <p ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point || card.summary || '')}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <ul ${styleAttr(card, 'key_points')}>
                    ${safeList(card.key_points).map((point) => `<li>${escapeHTML(point)}</li>`).join('')}
                </ul>
            </div>
            ${card.quote ? `<div class="quote-section" ${styleAttr(card, 'quote')}>"${escapeHTML(card.quote)}"</div>` : ''}
            ${card.action ? `
            <div class="detail-section">
                <h4>行动建议</h4>
                <p ${styleAttr(card, 'action')}>${escapeHTML(card.action)}</p>
            </div>` : ''}
            ${safeList(card.sourceCards).length ? `
            <div class="detail-section">
                <h4>来源卡片</h4>
                <p>${safeList(card.sourceCards).map((id) => escapeHTML(id)).join('、')}</p>
            </div>` : ''}
            ${card.note ? renderNoteSection(card.note, card) : ''}
        `;
    } else {
        // 普通卡片/待办卡片布局
        contentHtml = `
            <span class="detail-badge">${escapeHTML(card.category)}</span>
            <h2 class="detail-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h2>
            <div class="detail-section">
                <h4>核心观点</h4>
                <p ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point)}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <ul ${styleAttr(card, 'key_points')}>
                    ${safeList(card.key_points).map(p => `<li>${escapeHTML(p)}</li>`).join('')}
                </ul>
            </div>
            ${card.quote ? `<div class="quote-section" ${styleAttr(card, 'quote')}>"${escapeHTML(card.quote)}"</div>` : ''}
            ${card.action ? `
            <div class="detail-section">
                <h4>行动建议</h4>
                <p ${styleAttr(card, 'action')}>${escapeHTML(card.action)}</p>
            </div>` : ''}
            ${card.note ? renderNoteSection(card.note, card) : ''}
        `;
    }
    
    els.modalBody.innerHTML = contentHtml;
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

function renderCardEditForm(card) {
    normalizeCard(card);
    return `
        <span class="detail-badge">编辑卡片</span>
        <div class="edit-form">
            ${renderEditField('title', '标题', 'input', card.title, card)}
            <label>领域<input id="edit-category" value="${escapeHTML(card.category || '')}"></label>
            ${renderEditField('core_point', '核心观点', 'textarea', card.core_point || card.summary || '', card)}
            ${renderEditField('key_points', '关键要点', 'textarea', safeList(card.key_points).join('\n'), card)}
            ${renderEditField('quote', '金句', 'textarea', card.quote || '', card)}
            ${renderEditField('action', '行动建议', 'textarea', card.action || '', card)}
            ${renderEditField('note', '自由补充', 'textarea', card.note || '', card)}
            <label>视频链接<input id="edit-link" value="${escapeHTML(card.video_link || '')}"></label>
            <div class="edit-dock" aria-label="编辑工具栏">
                <button type="button" data-font-size="14px">A-</button>
                <button type="button" data-font-size="16px">A</button>
                <button type="button" data-font-size="18px">A+</button>
                <span class="dock-divider"></span>
                <button type="button" class="color-dot" data-color="#1f1f1d" style="--dot:#1f1f1d" title="黑色"></button>
                <button type="button" class="color-dot" data-color="#c44f45" style="--dot:#c44f45" title="红色"></button>
                <button type="button" class="color-dot" data-color="#2563eb" style="--dot:#2563eb" title="蓝色"></button>
                <button type="button" class="color-dot" data-color="#6f6b65" style="--dot:#6f6b65" title="灰色"></button>
                <span class="dock-divider"></span>
                <button type="button" data-format="bold"><strong>B</strong></button>
                <button type="button" data-format="underline"><u>U</u></button>
                <button type="button" data-format="italic"><em>I</em></button>
            </div>
        </div>
    `;
}

function renderEditField(field, label, type, value, card) {
    const styles = card.customStyles[field] || TEXT_STYLE_DEFAULTS[field];
    const controlId = `edit-${field}`;
    const editFontSize = '16px';
    const control = type === 'input'
        ? `<input id="${controlId}" data-style-field="${field}" value="${escapeHTML(value)}" style="font-size:${editFontSize};color:${escapeHTML(styles.color)};font-weight:${escapeHTML(styles.fontWeight || '400')};font-style:${escapeHTML(styles.fontStyle || 'normal')};text-decoration:${escapeHTML(styles.textDecoration || 'none')}">`
        : `<textarea id="${controlId}" data-style-field="${field}" style="font-size:${editFontSize};color:${escapeHTML(styles.color)};font-weight:${escapeHTML(styles.fontWeight || '400')};font-style:${escapeHTML(styles.fontStyle || 'normal')};text-decoration:${escapeHTML(styles.textDecoration || 'none')}">${escapeHTML(value)}</textarea>`;

    return `
        <label class="editable-field" data-field="${field}">
            <span>${escapeHTML(label)}</span>
            ${control}
        </label>
    `;
}

function bindEditStyleControls() {
    els.modalBody.querySelectorAll('[data-style-field]').forEach((input) => {
        input.addEventListener('focus', () => {
            activeEditField = input.dataset.styleField;
        });
        input.addEventListener('click', () => {
            activeEditField = input.dataset.styleField;
        });
    });

    els.modalBody.querySelectorAll('.edit-dock button').forEach((button) => {
        button.addEventListener('click', () => {
            const input = els.modalBody.querySelector(`[data-style-field="${activeEditField}"]`);
            if (!input) return;
            if (button.dataset.fontSize) {
                input.style.fontSize = button.dataset.fontSize;
            }
            if (button.dataset.color) {
                input.style.color = button.dataset.color;
            }
            if (button.dataset.format === 'bold') {
                input.style.fontWeight = input.style.fontWeight === '700' ? '400' : '700';
            }
            if (button.dataset.format === 'underline') {
                input.style.textDecoration = input.style.textDecoration.includes('underline') ? 'none' : 'underline';
            }
            if (button.dataset.format === 'italic') {
                input.style.fontStyle = input.style.fontStyle === 'italic' ? 'normal' : 'italic';
            }
            input.focus();
        });
    });
}

function renderNoteSection(note, card = null) {
    return `
        <div class="detail-section note-section">
            <h4>记事本内容</h4>
            <p ${card ? styleAttr(card, 'note') : ''}>${escapeHTML(note)}</p>
        </div>
    `;
}

function saveEditedCard() {
    const card = cards.find(c => c.id === currentViewCardId);
    if (!card) return;
    normalizeCard(card);
    card.title = document.getElementById('edit-title').value.trim() || card.title;
    card.category = document.getElementById('edit-category').value.trim() || '未分类';
    card.core_point = document.getElementById('edit-core_point').value.trim();
    card.key_points = document.getElementById('edit-key_points').value.split('\n').map(p => p.trim()).filter(Boolean);
    card.quote = document.getElementById('edit-quote').value.trim();
    card.action = document.getElementById('edit-action').value.trim();
    card.note = document.getElementById('edit-note').value.trim();
    card.video_link = document.getElementById('edit-link').value.trim();
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
    }
    renderCards();
    renderDailyReview();
    openCardDetail(sourceCard, false);
}

function playGetAnimation() {
    const target = document.querySelector('[data-mobile-action="review"]');
    const start = els.btnAddTodo.getBoundingClientRect();
    const end = target?.getBoundingClientRect();
    if (!end) return;
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
    try {
        return JSON.parse(content);
    } catch (e) {
        console.error('[Zcard] JSON 解析失败:', e.message);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            console.log('[Zcard] 尝试从内容中提取 JSON');
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('AI 返回的内容不是有效 JSON: ' + content.substring(0, 100));
    }
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
        action: '复盘这条内容，并补充自己的理解。',
        category: '学习',
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

    const cleanedInput = cleanSharedText(text);
    if (cleanedInput) {
        text = cleanedInput;
    }
    console.log('[Zcard] 文本清洗完毕, 长度:', text.length);

    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';

    let prompt = "";
    
    // 如果文本中包含多个链接以及对应说明文字，我们将其视为多源融合输入
    if (linkMatches.length > 1) {
        // 多视频融合 Prompt
        prompt = `你是一个知识整合专家。用户提供了多个信息源（视频或文章）的内容，请你将它们融合成一张结构化的知识卡片。严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式。

返回格式：
{"title": "综合提炼的标题（10字以内）", "core_point": "综合核心观点（一句话总结这几个信息源的共性）", "key_points": ["观点一：xxx（来自信息源1）", "观点二：xxx（来自信息源2）", "观点三：xxx（综合分析）"], "quote": "最精彩的一句金句", "action": "行动建议", "category": "生活"}

字段要求：
1. 所有字段必须使用中文。
2. category 必须且只能是以下之一：生活、职场、学习、娱乐、财经、健康、科技。
3. 如果内容只有链接、缺少正文，请根据链接附近的分享文案提炼，不要说无法访问链接。

视频内容如下：
${text}`;
    } else {
        // 单视频 Prompt
        prompt = `你是一个视频内容分析专家。请对以下抖音视频内容进行结构化总结，严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式：

{"title": "标题（10字以内）", "core_point": "核心观点（一句话）", "key_points": ["要点1", "要点2", "要点3"], "quote": "金句", "action": "行动建议", "category": "学习"}

字段要求：
1. 所有字段必须使用中文。
2. category 必须且只能是以下之一：生活、职场、学习、娱乐、财经、健康、科技。
3. 如果内容只有链接、缺少正文，请根据链接附近的分享文案提炼，不要说无法访问链接。

视频内容：
${text}`;
    }

    let result;
    try {
        console.log('[Zcard] 开始调用 API...');
        result = await callDeepSeek(prompt);
        console.log('[Zcard] API 调用成功:', JSON.stringify(result).substring(0, 80));
    } catch (error) {
        console.warn('[Zcard] AI 调用失败，已使用本地演示模式生成卡片。', error);
        result = createLocalCard(text, videoLink);
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
    includeCardInTodayReviewSession(newCard.id);
    
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
    document.querySelectorAll('.category-tag').forEach(el => {
        el.classList.toggle('active', el.dataset.category === '全部');
    });
    els.searchInput.placeholder = '在【全部】中搜索...';
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
    const normalized = {
        title: String(result?.title || '').trim(),
        core_point: String(result?.core_point || result?.summary || '').trim(),
        key_points: safeList(result?.key_points).map((item) => String(item).trim()).filter(Boolean),
        quote: String(result?.quote || result?.conclusion || '').trim(),
        action: String(result?.action || '').trim(),
        category: normalizeCategory(result?.category || category),
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
            quote: '7年亏了82亿元，这些坑踩得太致命。',
            action: '企业应聚焦核心业务，加强风险管控；投资者需关注影视行业系统性风险。',
            category: '财经',
            sourceCards: [...REQUIRED_DEMO_CARD_IDS]
        };
    }

    const mergedPoints = [...new Set(selectedCardsData.flatMap((card) => safeList(card.key_points)).filter(Boolean))].slice(0, 5);
    while (mergedPoints.length < 4) {
        mergedPoints.push(['补充事件背景，串起前因后果', '合并重复信息，提炼关键节点', '从结果反推问题根源，形成完整认知'][mergedPoints.length - 1] || '提炼共同信息，形成一张完整卡片');
    }
    const quotes = selectedCardsData.map((card) => card.quote).filter(Boolean);
    const actions = [...new Set(selectedCardsData.map((card) => card.action).filter(Boolean))];
    const corePoints = [...new Set(selectedCardsData.map((card) => card.core_point || card.summary).filter(Boolean))];

    return {
        title: `${selectedCardsData[0]?.title?.slice(0, 6) || '事件'}整合`,
        core_point: corePoints.join('；').slice(0, 70) || '这组卡片反映的是同一话题下的多维信息，需要合并理解。',
        key_points: mergedPoints,
        quote: quotes.length >= 2 ? `${quotes[0]}，${quotes[1]}`.slice(0, 36) : (quotes[0] || '把碎片信息串起来，才能看清全貌。'),
        action: actions[0] || '把整合后的信息再复盘一遍，确认核心结论与行动方向。',
        category,
        sourceCards: selectedCardsData.map((card) => card.id)
    };
}

function isRequiredDemoSelection(selectedCardsData) {
    const selectedIds = selectedCardsData.map((card) => card.id).sort();
    return REQUIRED_DEMO_CARD_IDS.every((id) => selectedIds.includes(id)) && selectedIds.length === REQUIRED_DEMO_CARD_IDS.length;
}

function showIntegratePreview(result, selectedCardsData, category, copyText) {
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
            ${safeList(result.key_points).length ? `<ul>${safeList(result.key_points).map((point) => `<li>${escapeHTML(point)}</li>`).join('')}</ul>` : ''}
            ${result.quote ? `<p><strong>金句：</strong>${escapeHTML(result.quote)}</p>` : ''}
            ${result.action ? `<p><strong>行动建议：</strong>${escapeHTML(result.action)}</p>` : ''}
        </div>
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
    const categories = [...new Set(selectedCardsData.map((card) => card.category).filter(Boolean))];
    const targetCategory = categories[0] || '学习';
    if (categories.length > 1) {
        alert('请勾选同一领域的卡片后再整合。');
        return;
    }

    if (isRequiredDemoSelection(selectedCardsData)) {
        const result = createLocalIntegratedCard(selectedCardsData, targetCategory);
        showIntegratePreview(result, selectedCardsData, targetCategory, `将整合 ${selectedCardsData.length} 张演示卡片，确认后原小卡片会被移除。`);
        return;
    }

    const combinedContent = selectedCardsData.map((card, index) => `卡片${index + 1}
标题：${card.title}
核心观点：${card.core_point || card.summary || ''}
关键要点：${safeList(card.key_points).join('；')}
金句：${card.quote || ''}
行动建议：${card.action || ''}`).join('\n\n');

    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您整合多重视角...';
    els.loadingIndicator.classList.remove('hidden');

    const prompt = `你是一个知识整合专家。以下是同一领域、同一事件/话题的多张知识卡片，请整合成一张更完整的大卡片。

要求：
1. 只返回 JSON，不要返回任何其他文字，不要使用 markdown。
2. 标题控制在 14 字以内，适合做一张完整知识卡片的标题。
3. core_point 用 1 句话总结整体核心观点。
4. key_points 返回 4 到 5 条，去重、合并重复信息，每条不超过 28 字。
5. quote 把原卡片里的强记忆点合并成一句更有记忆点的话。
6. action 给出 1 条清晰的行动建议。
7. category 固定返回 "${targetCategory}"。

返回格式：
{"title":"整合标题","core_point":"核心观点","key_points":["要点1","要点2","要点3","要点4"],"quote":"金句","action":"行动建议","category":"${targetCategory}"}

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

    const integratedCard = {
        id: 'int_' + Date.now(),
        title: result.title,
        core_point: result.core_point,
        summary: result.core_point,
        key_points: safeList(result.key_points),
        quote: result.quote || '',
        action: result.action || '',
        category,
        created_at: new Date().toISOString().split('T')[0],
        is_todo: false,
        isIntegrated: true,
        is_integrated: true,
        isRead: false,
        readAt: '',
        isFavorite: false,
        isDemo: false,
        customStyles: {},
        sourceCards: cards.filter((card) => selectedIds.has(card.id)).map((card) => card.id),
        source_links: cards.filter((card) => selectedIds.has(card.id)).map((card) => card.video_link).filter(Boolean)
    };

    cards = cards.filter((card) => !selectedIds.has(card.id));
    cards.unshift(normalizeCard(integratedCard));
    saveCards();

    selectedCards.clear();
    pendingIntegrateResult = null;
    updateBatchActions();
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
    els.fcPoints.innerHTML = safeList(card.key_points).map(p => `<li>${escapeHTML(p)}</li>`).join('');
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
    const quoteLines = card.quote ? wrapCanvasText(ctx, `金句：${card.quote}`, innerWidth) : [];
    const actionLines = card.action ? wrapCanvasText(ctx, `行动建议：${card.action}`, innerWidth) : [];

    return (
        styles.cardPadding +
        styles.pillHeight +
        18 +
        titleLines.length * styles.titleLineHeight +
        12 +
        coreLines.length * styles.coreLineHeight +
        (pointLines.length ? 18 + pointLines.length * styles.pointLineHeight : 0) +
        (quoteLines.length ? 18 + quoteLines.length * styles.noteLineHeight : 0) +
        (actionLines.length ? 14 + actionLines.length * styles.noteLineHeight : 0) +
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
        const pillText = card.isIntegrated || card.is_integrated ? `整合 · ${card.category || '未分类'}` : (card.category || '未分类');
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
        const pointTexts = safeList(card.key_points).map((point) => `• ${point}`);
        if (pointTexts.length) {
            cursorY += 14;
            pointTexts.forEach((pointText) => {
                const lines = wrapCanvasText(ctx, pointText, innerWidth - 8);
                cursorY = drawExportTextBlock(ctx, lines, cursorX, cursorY + 10, styles.pointLineHeight, '#475569');
            });
        }

        ctx.font = styles.noteFont;
        if (card.quote) {
            const quoteLines = wrapCanvasText(ctx, `金句：${card.quote}`, innerWidth);
            cursorY = drawExportTextBlock(ctx, quoteLines, cursorX, cursorY + 16, styles.noteLineHeight, '#7c2d12');
        }
        if (card.action) {
            const actionLines = wrapCanvasText(ctx, `行动建议：${card.action}`, innerWidth);
            cursorY = drawExportTextBlock(ctx, actionLines, cursorX, cursorY + 12, styles.noteLineHeight, '#1d4ed8');
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
        alert('保存失败：浏览器本地存储空间不足或不可用。');
    }
}

// 启动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
