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

// API 配置
const API_URL = 'https://api.deepseek.com/chat/completions';
const PROXY_API_URL = '/api/deepseek';
const DEFAULT_DEMO_API_KEY = 'sk-4591f6e3f254426abe448bfc21e6d86d';
let API_KEY = sessionStorage.getItem('deepseek_api_key') || DEFAULT_DEMO_API_KEY;
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
    return card;
}

function styleAttr(card, field) {
    const styles = normalizeCard(card).customStyles[field] || TEXT_STYLE_DEFAULTS[field];
    return `style="font-size:${escapeHTML(styles.fontSize)};color:${escapeHTML(styles.color)};font-weight:${escapeHTML(styles.fontWeight || '400')};font-style:${escapeHTML(styles.fontStyle || 'normal')};text-decoration:${escapeHTML(styles.textDecoration || 'none')}"`;
}

function loadCards() {
    try {
        const parsed = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
        return Array.isArray(parsed) ? parsed.map(normalizeCard) : [];
    } catch (error) {
        console.warn('本地卡片数据损坏，已重置为空列表。', error);
        localStorage.removeItem('douyin_cards');
        return [];
    }
}

// DOM 元素库
const els = {
    videoInput: document.getElementById('video-input'),
    btnGenerate: document.getElementById('btn-generate'),
    loadingIndicator: document.getElementById('loading-indicator'),
    cardsContainer: document.getElementById('cards-container'),
    emptyState: document.getElementById('empty-state'),
    categoryList: document.getElementById('category-list'),
    searchInput: document.getElementById('search-input'),
    batchActions: document.getElementById('batch-actions'),
    selectedNum: document.getElementById('selected-num'),
    btnIntegrate: document.getElementById('btn-integrate'),
    btnExport: document.getElementById('btn-export'),
    btnCancelSelect: document.getElementById('btn-cancel-select'),
    reviewSection: document.getElementById('review-section'),
    reviewCard: document.getElementById('review-card'),
    reviewTitle: document.getElementById('review-title'),
    reviewCore: document.getElementById('review-core'),
    btnReviewDo: document.getElementById('btn-review-do'),
    btnReviewSkip: document.getElementById('btn-review-skip'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    searchModal: document.getElementById('search-modal'),
    btnCloseSearch: document.getElementById('btn-close-search'),
    searchResults: document.getElementById('search-results'),
    searchResultTitle: document.getElementById('search-result-title'),
    searchResultCount: document.getElementById('search-result-count'),
    actionModal: document.getElementById('action-modal'),
    btnActionDetail: document.getElementById('btn-action-detail'),
    btnActionDouyin: document.getElementById('btn-action-douyin'),
    btnActionCancel: document.getElementById('btn-action-cancel'),
    
    // Modals
    cardModal: document.getElementById('card-modal'),
    modalBody: document.getElementById('modal-card-body'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnDeleteCard: document.getElementById('btn-delete-card'),
    btnAddTodo: document.getElementById('btn-add-todo'),
    btnEditCard: document.getElementById('btn-edit-card'),
    btnSaveCard: document.getElementById('btn-save-card'),
    btnCancelEdit: document.getElementById('btn-cancel-edit'),
    notebookModal: document.getElementById('notebook-modal'),
    btnCloseNotebook: document.getElementById('btn-close-notebook'),
    notebookInput: document.getElementById('notebook-input'),
    btnSaveNotebook: document.getElementById('btn-save-notebook'),
    
    flashcardModal: document.getElementById('flashcard-modal'),
    btnFlashcard: document.getElementById('btn-flashcard'),
    btnCloseFlashcard: document.getElementById('btn-close-flashcard'),
    flashcardElement: document.getElementById('flashcard-element'),
    fcActions: document.getElementById('flashcard-actions'),
    fcTitle: document.getElementById('fc-title'),
    fcCore: document.getElementById('fc-core'),
    fcPoints: document.getElementById('fc-points'),
    fcCategory: document.getElementById('fc-category'),
    fcProgress: document.getElementById('flashcard-progress'),
    btnFcForget: document.getElementById('btn-fc-forget'),
    btnFcRemember: document.getElementById('btn-fc-remember'),
    
    settingsModal: document.getElementById('settings-modal'),
    btnSettings: document.getElementById('btn-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    apiKeyInput: document.getElementById('api-key-input'),
    btnSaveSettings: document.getElementById('btn-save-settings'),

    // 整合预览弹窗
    integratePreviewModal: document.getElementById('integrate-preview-modal'),
    btnCloseIntegratePreview: document.getElementById('btn-close-integrate-preview'),
    integratePreviewTitle: document.getElementById('integrate-preview-title'),
    integratePreviewBody: document.getElementById('integrate-preview-body'),
    btnCancelIntegrate: document.getElementById('btn-cancel-integrate'),
    btnConfirmIntegrate: document.getElementById('btn-confirm-integrate'),

    // 左右滑动复习
    swipeModal: document.getElementById('swipe-review-modal'),
    btnCloseSwipeReview: document.getElementById('btn-close-swipe-review'),
    swipeScene: document.getElementById('swipe-review-scene'),
    swipeCard: document.getElementById('swipe-review-card'),
    swipeProgress: document.getElementById('swipe-review-progress'),
    swipeArrowLeft: document.getElementById('swipe-arrow-left'),
    swipeArrowRight: document.getElementById('swipe-arrow-right'),
    swipeDone: document.getElementById('swipe-done'),
    swipeStatUnderstood: document.getElementById('swipe-stat-understood'),
    swipeStatConfused: document.getElementById('swipe-stat-confused'),
    btnSwipeDoneClose: document.getElementById('btn-swipe-done-close'),
    srCategory: document.getElementById('sr-category'),
    srTitle: document.getElementById('sr-title'),
    srCore: document.getElementById('sr-core'),
    srPoints: document.getElementById('sr-points')
};

// 当前操作的卡片 ID
let currentViewCardId = null;

// 初始化
function init() {
    initDemoCards();
    refreshIcons();
    renderCards();
    renderDailyReview();
    bindEvents();
}

// 首次访问生成演示卡片
function initDemoCards() {
    if (localStorage.getItem('douyin_cards')) return;
    const demoCards = [
        {
            id: 'demo_1',
            title: '普通人如何理财',
            core_point: '理财不是有钱人的专利，普通人更需要从小额定投开始，建立被动收入管道。',
            key_points: ['先存后花，每月固定存 10%', '指数基金定投是懒人最优解', '远离高杠杆产品，保住本金最重要'],
            quote: '你不理财，财不理你；但乱理财，财就离你。',
            action: '今天就开始设置每月自动定投计划。',
            category: '财经',
            video_link: '',
            created_at: new Date().toISOString().split('T')[0],
            is_todo: false, is_integrated: false,
            isRead: false, readAt: '',
            isFavorite: false, isDemo: true,
            customStyles: {}
        },
        {
            id: 'demo_2',
            title: 'AI 时代的核心能力',
            core_point: 'AI 不会取代你，但会用 AI 的人会取代你。学会提问和判断，比学会操作更重要。',
            key_points: ['学会给 AI 写好提示词', '培养批判性思维，验证 AI 输出', '把 AI 当副驾驶，不是自动驾驶'],
            quote: '未来的文盲不是不识字的人，而是不会和 AI 协作的人。',
            action: '选一个日常任务，尝试用 AI 工具完成。',
            category: '科技',
            video_link: '',
            created_at: new Date().toISOString().split('T')[0],
            is_todo: false, is_integrated: false,
            isRead: false, readAt: '',
            isFavorite: false, isDemo: true,
            customStyles: {}
        },
        {
            id: 'demo_3',
            title: '高效睡眠的秘密',
            core_point: '睡眠质量比时长更重要，90 分钟周期法和睡前仪式感是提升睡眠的关键。',
            key_points: ['按 90 分钟倍数设定闹钟', '睡前 1 小时远离屏幕', '固定起床时间比固定入睡时间更重要'],
            quote: '睡得好，才能活得好。',
            action: '今晚试试 90 分钟周期法，设 7.5 小时睡眠。',
            category: '生活',
            video_link: '',
            created_at: new Date().toISOString().split('T')[0],
            is_todo: false, is_integrated: false,
            isRead: false, readAt: '',
            isFavorite: false, isDemo: true,
            customStyles: {}
        }
    ];
    cards = demoCards.map(normalizeCard);
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
        const starBtn = e.target.closest('.card-got-toggle');
        if (!starBtn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        const card = cards.find(item => item.id === starBtn.dataset.id);
        if (card) toggleGotCard(card);
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

    els.btnReviewSkip.addEventListener('click', () => completeReviewCard(false));
    els.btnReviewDo.addEventListener('click', () => completeReviewCard(true));

    // 点击今日复习卡片进入滑动复习模式
    els.reviewCard.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return; // 不拦截按钮点击
        openSwipeReview();
    });

    // 滑动复习弹窗
    els.btnCloseSwipeReview.addEventListener('click', closeSwipeReview);
    els.btnSwipeDoneClose.addEventListener('click', closeSwipeReview);
    bindSwipeReviewGestures();
    
    // 闪卡复习
    els.btnFlashcard.addEventListener('click', startFlashcardMode);
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
    
    if (filtered.length === 0) {
        els.emptyState.classList.remove('hidden');
        els.cardsContainer.appendChild(els.emptyState);
        return;
    }
    
    els.emptyState.classList.add('hidden');
    
    filtered.forEach(card => {
        const cardEl = document.createElement('div');
        normalizeCard(card);
        cardEl.className = `knowledge-card-wrap ${card.is_integrated ? 'integrated' : ''} ${card.isFavorite ? 'got-card' : ''} ${card.isRead ? 'read-card' : ''} ${card.is_todo && card.todo_status === '已完成' ? 'todo-completed' : ''}`;
        const canIntegrate = getSameCategoryCards(card).length >= 2 && !card.is_integrated;
        
        const starHtml = `
            <button type="button" class="card-got-toggle ${card.isFavorite ? 'active' : ''}" data-id="${escapeHTML(card.id)}" title="${card.isFavorite ? '取消收藏' : '收藏'}" aria-label="${card.isFavorite ? '取消收藏' : '收藏'}">
                <i data-lucide="star"></i>
            </button>
        `;
        
        cardEl.innerHTML = `
            <button type="button" class="swipe-delete" data-id="${escapeHTML(card.id)}">
                <i data-lucide="trash-2"></i>
                <span>删除</span>
            </button>
            <div class="knowledge-card swipe-card">
                <div class="card-header">
                    <span class="card-badge">${escapeHTML(card.is_integrated ? '整合' : (card.is_todo ? '待办' : card.category))}</span>
                    ${starHtml}
                </div>
                <h3 class="card-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h3>
                <p class="card-core" ${styleAttr(card, 'core_point')}>${escapeHTML(card.core_point || card.summary || '')}</p>
                <div class="card-footer">
                <span>${escapeHTML(card.created_at)}</span>
                ${canIntegrate ? '<span class="merge-hint">可整合</span>' : ''}
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
            if (e.target.closest('.card-got-toggle') || e.target.closest('.swipe-delete')) return;
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

        const starBtn = cardEl.querySelector('.card-got-toggle');
        ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach((eventName) => {
            starBtn.addEventListener(eventName, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });

        bindSwipeToDelete(cardEl);
        
        els.cardsContainer.appendChild(cardEl);
    });
    refreshIcons();
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
        <article class="knowledge-card search-result-card ${card.isFavorite ? 'got-card' : ''}" data-id="${escapeHTML(card.id)}">
            <div class="card-header">
                <span class="card-badge">${escapeHTML(card.category || '未分类')}</span>
                ${card.isFavorite ? '<span class="got-star" title="已收藏">⭐</span>' : ''}
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

function toggleGotCard(card) {
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
    els.selectedNum.textContent = selectedCards.size;
    if (selectedCards.size > 0) {
        els.batchActions.classList.remove('hidden');
        els.btnIntegrate.style.display = selectedCards.size >= 2 ? 'inline-flex' : 'none';
    } else {
        els.batchActions.classList.add('hidden');
    }
}

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

function renderDailyReview() {
    const today = todayKey();
    const gotCards = cards.filter(card => card.isRead && !card.is_integrated);
    const available = gotCards.filter(card => card.reviewed_on !== today);
    if (available.length === 0) {
        currentReviewCardId = null;
        els.reviewTitle.textContent = gotCards.length
            ? '今日复习完成'
            : '还没有Get任何卡片';
        els.reviewCore.textContent = gotCards.length
            ? '今天加入复习池的卡片都已经复习过了。点击卡片进入复习模式。'
            : '还没有已读卡片，先打开详情页点击 Get it 吧！';
        els.btnReviewDo.classList.add('hidden');
        els.btnReviewSkip.classList.add('hidden');
        els.reviewCard.classList.remove('shattering', 'reviewing');
        els.reviewSection.classList.remove('hidden');
        return;
    }
    const index = Math.floor(Math.random() * available.length);
    const card = available[index];
    currentReviewCardId = card.id;
    els.reviewTitle.textContent = card.title || '知识复习';
    els.reviewCore.textContent = card.core_point || card.summary || '打开一张卡片，回忆它的核心观点。';
    els.btnReviewDo.classList.remove('hidden');
    els.btnReviewSkip.classList.remove('hidden');
    els.reviewCard.classList.remove('shattering', 'reviewing');
    els.reviewSection.classList.remove('hidden');
    // 更新提示文字
    const metaSpan = els.reviewCard.querySelector('.review-meta span');
    if (metaSpan) metaSpan.textContent = `今日复习 · 点击进入滑动复习 (${available.length}张)`;
}

function completeReviewCard(withEffect) {
    const card = cards.find(c => c.id === currentReviewCardId);
    if (!card) return;
    window.clearTimeout(reviewRevealTimer);
    const finish = () => {
        card.reviewed_on = todayKey();
        saveCards();
        renderDailyReview();
    };
    if (withEffect) {
        els.reviewCard.classList.add('reviewing');
        els.reviewCore.innerHTML = `
            <strong>${escapeHTML(card.core_point || card.summary || '')}</strong>
            <span>${safeList(card.key_points).slice(0, 3).map(escapeHTML).join(' / ')}</span>
        `;
        reviewRevealTimer = window.setTimeout(() => {
            els.reviewCard.classList.add('shattering');
            setTimeout(finish, 900);
        }, 3000);
    } else {
        finish();
    }
}

// 左右滑动复习模式
function openSwipeReview() {
    swipeReviewQueue = cards.filter(c => c.isRead && !c.is_integrated);
    if (swipeReviewQueue.length === 0) {
        alert('还没有已读卡片，先去详情页点击 Get it 吧！');
        return;
    }
    // 随机打乱
    for (let i = swipeReviewQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [swipeReviewQueue[i], swipeReviewQueue[j]] = [swipeReviewQueue[j], swipeReviewQueue[i]];
    }
    swipeReviewIndex = 0;
    swipeUnderstood = 0;
    swipeConfused = 0;
    els.swipeDone.classList.add('hidden');
    els.swipeScene.style.display = '';
    document.querySelector('.swipe-head').style.display = '';
    els.swipeModal.classList.remove('hidden');
    renderSwipeReviewCard();
}

function closeSwipeReview() {
    els.swipeModal.classList.add('hidden');
    renderDailyReview();
}

function renderSwipeReviewCard() {
    if (swipeReviewIndex >= swipeReviewQueue.length) {
        // 复习完成
        els.swipeScene.style.display = 'none';
        document.querySelector('.swipe-head').style.display = 'none';
        els.swipeStatUnderstood.textContent = swipeUnderstood;
        els.swipeStatConfused.textContent = swipeConfused;
        els.swipeDone.classList.remove('hidden');
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
    refreshIcons();
}

function bindSwipeReviewGestures() {
    const scene = els.swipeScene;
    const card = els.swipeCard;
    const arrowL = els.swipeArrowLeft;
    const arrowR = els.swipeArrowRight;
    let startX = 0, startY = 0, dx = 0, dragging = false;
    let dirLock = null;

    scene.addEventListener('pointerdown', (e) => {
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
            // 左滑 → 理解
            swipeUnderstood++;
            card.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease';
            card.style.transform = 'translateX(-110%) rotate(-10deg)';
            card.style.opacity = '0';
            setTimeout(() => {
                card.style.transition = '';
                swipeReviewIndex++;
                renderSwipeReviewCard();
            }, 320);
        } else if (dx > 60) {
            // 右滑 → 没理解，也进入下一张
            swipeConfused++;
            card.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease';
            card.style.transform = 'translateX(110%) rotate(10deg)';
            card.style.opacity = '0';
            setTimeout(() => {
                card.style.transition = '';
                swipeReviewIndex++;
                renderSwipeReviewCard();
            }, 320);
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
        // 整合卡片布局
        contentHtml = `
            <span class="detail-badge">整合卡片</span>
            <h2 class="detail-title" ${styleAttr(card, 'title')}>${escapeHTML(card.title)}</h2>
            <div class="detail-section">
                <h4>综合观点</h4>
                <p ${styleAttr(card, 'core_point')}>${escapeHTML(card.summary)}</p>
            </div>
            <div class="detail-section">
                <h4>多角度分析</h4>
                <ul ${styleAttr(card, 'key_points')}>
                    ${safeList(card.angles).map(a => `<li>${escapeHTML(a)}</li>`).join('')}
                </ul>
            </div>
            <div class="quote-section" ${styleAttr(card, 'quote')}>
                <strong>关键结论：</strong>${escapeHTML(card.conclusion)}
            </div>
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
    if (card.is_todo || card.is_integrated) {
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
    els.btnAddTodo.classList.toggle('hidden', editMode || card.is_todo || card.is_integrated);
    
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
    try {
        const useProxy = !API_KEY;
        const headers = { 'Content-Type': 'application/json' };
        if (!useProxy) {
            headers.Authorization = `Bearer ${API_KEY}`;
        }

        const response = await fetch(useProxy ? PROXY_API_URL : API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(useProxy ? { prompt } : {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' } // 强制 JSON 返回
            })
        });
        
        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            const message = errorPayload.error
                || (useProxy && response.status === 404
                ? '未检测到后端代理。请运行 server.js，或在设置里临时填写 API Key'
                : response.status === 401
                    ? 'API Key 无效或已过期'
                    : response.status === 429
                        ? 'API 请求过于频繁'
                        : `DeepSeek API 返回 ${response.status}`);
            throw new Error(message);
        }
        
        const data = await response.json();
        let content = data?.content || data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI 返回内容为空');
        }
        
        // 尝试解析 JSON，处理可能的 markdown 包装和前后说明文字
        content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        try {
            return JSON.parse(content);
        } catch {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error('AI 返回的内容不是有效 JSON');
        }
        
    } catch (error) {
        console.error(error);
        throw error;
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
    let text = els.videoInput.value.trim();
    if (!text) {
        alert('请先输入视频文案或链接');
        return;
    }
    
    // 提取所有可能的链接（支持多个链接）
    const linkMatches = text.match(/https?:\/\/[^\s]+/g) || [];
    const videoLink = linkMatches.length > 0 ? linkMatches[0] : ''; // 记录第一个作为主要来源
    
    els.loadingIndicator.classList.remove('hidden');
    els.btnGenerate.disabled = true;
    
    const cleanedInput = cleanSharedText(text);
    if (cleanedInput) {
        text = cleanedInput;
    }
    
    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    
    let prompt = "";
    
    // 如果文本中包含多个链接以及对应说明文字，我们将其视为多源融合输入
    if (linkMatches.length > 1) {
        // 多视频融合 Prompt
        prompt = `你是一个知识整合专家。用户提供了多个信息源（视频或文章）的内容，请你将它们融合成一张结构化的知识卡片。严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式。

返回格式：
{"title": "综合提炼的标题（10字以内）", "core_point": "综合核心观点（一句话总结这几个信息源的共性）", "key_points": ["观点一：xxx（来自信息源1）", "观点二：xxx（来自信息源2）", "观点三：xxx（综合分析）"], "quote": "最精彩的一句金句", "action": "行动建议", "category": "从以下选择：生活/职场/学习/娱乐/财经/健康/科技"}

视频内容如下：
${text}`;
    } else {
        // 单视频 Prompt
        prompt = `你是一个视频内容分析专家。请对以下抖音视频内容进行结构化总结，严格按JSON格式返回，不要返回任何其他文字，不要使用markdown格式：

{"title": "标题（10字以内）", "core_point": "核心观点（一句话）", "key_points": ["要点1", "要点2", "要点3"], "quote": "金句", "action": "行动建议", "category": "从以下选择：生活/职场/学习/娱乐/财经/健康/科技"}

视频内容：
${text}`;
    }

    let result;
    try {
        result = await callDeepSeek(prompt);
    } catch (error) {
        console.warn('AI 调用失败，已使用本地演示模式生成卡片。', error);
        result = createLocalCard(text, videoLink);
    }
        
    const newCard = {
        id: 'card_' + Date.now(),
        ...result,
        video_link: result.video_link || videoLink,
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
    currentCategory = '全部';
    document.querySelectorAll('.category-tag').forEach(el => {
        el.classList.toggle('active', el.dataset.category === '全部');
    });
    renderCards();
    renderDailyReview();
    
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

// 整合卡片 —— 第一步：调 AI 并预览
async function handleIntegrateCards() {
    if (selectedCards.size < 2) return;

    const selectedCardsData = cards.filter(c => selectedCards.has(c.id));
    const combinedContent = selectedCardsData.map(c => `标题：${c.title}\n观点：${c.core_point || c.summary}\n要点：${(c.key_points || c.angles || []).join('，')}`).join('\n\n');
    const categories = [...new Set(selectedCardsData.map(c => c.category).filter(Boolean))];
    const isCrossCategory = categories.length > 1;

    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您整合多重视角...';
    els.loadingIndicator.classList.remove('hidden');

    const prompt = isCrossCategory
        ? `你是一个创意整合专家。用户选择了以下不同领域的卡片，请将它们整合成一张充满想象力的创意卡片。

要求：
1. 生成一个有趣、夸张的创意标题，将不同领域元素融合在一起
2. 描述这个创意场景的关键要点
3. 只返回JSON格式，不要其他文字

返回格式：
{"title": "创意标题（15字以内）", "scenario": "场景描述（50字以内）", "key_points": ["要点1", "要点2", "要点3"], "category": "揉杂"}

选择的卡片内容：
${combinedContent}`
        : `你是一个知识整合专家。以下是关于同一事件/主题的多个视频分析卡片，请整合成一张汇总卡片。

要求：
1. 只返回JSON格式，不要返回任何其他文字
2. 不要使用markdown格式
3. 每个要点不超过30个字

返回格式：
{"title": "汇总标题", "summary": "综合观点（50字以内）", "angles": ["角度1", "角度2", "角度3"], "conclusion": "关键结论（30字以内）"}

卡片内容：
${combinedContent}`;

    try {
        const result = await callDeepSeek(prompt);

        // 暂存结果，等用户确认
        pendingIntegrateResult = {
            result,
            selectedIds: new Set(selectedCards),
            isCrossCategory,
            category: isCrossCategory ? '揉杂' : selectedCardsData[0].category
        };

        // 显示预览弹窗
        const summary = result.summary || result.scenario || result.core_point || '';
        const points = result.angles || result.key_points || [];
        const conclusion = result.conclusion || '';

        els.integratePreviewTitle.textContent = result.title || '整合结果';
        els.integratePreviewBody.innerHTML = `
            <div class="preview-card">
                <span class="card-badge">${escapeHTML(pendingIntegrateResult.category)}</span>
                <h3>${escapeHTML(result.title || '无标题')}</h3>
                <p>${escapeHTML(summary)}</p>
                ${points.length ? `<ul>${points.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ul>` : ''}
                ${conclusion ? `<p><strong>结论：</strong>${escapeHTML(conclusion)}</p>` : ''}
            </div>
            <div class="source-cards-info">将整合 ${selectedCardsData.length} 张卡片</div>
        `;
        els.integratePreviewModal.classList.remove('hidden');
        refreshIcons();

    } catch (e) {
        alert(`整合失败：${e.message || '请检查 API Key 或网络连接'}`);
    } finally {
        els.loadingIndicator.classList.add('hidden');
        els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    }
}

// 整合预览 —— 确认
function confirmIntegrate() {
    if (!pendingIntegrateResult) return;
    const { result, selectedIds, isCrossCategory, category } = pendingIntegrateResult;

    const integratedCard = {
        id: 'int_' + Date.now(),
        ...result,
        summary: result.summary || result.scenario || result.core_point,
        core_point: result.core_point || result.summary || result.scenario,
        category,
        created_at: new Date().toISOString().split('T')[0],
        is_todo: false,
        is_integrated: true,
        isRead: false,
        readAt: '',
        isFavorite: false,
        customStyles: {},
        source_links: cards.filter(c => selectedIds.has(c.id)).map(c => c.video_link).filter(Boolean)
    };

    if (!isCrossCategory) {
        cards = cards.filter(c => !selectedIds.has(c.id));
    }
    cards.unshift(integratedCard);
    saveCards();

    selectedCards.clear();
    pendingIntegrateResult = null;
    updateBatchActions();
    renderCards();
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
    flashcardQueue = cards.filter(c => c.isRead && !c.is_integrated);

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

// 导出图片 (html2canvas)
async function handleExportImages() {
    if (selectedCards.size === 0) return;
    
    const selectedCardsData = cards.filter(c => selectedCards.has(c.id));
    const container = document.getElementById('export-container');
    container.innerHTML = '';
    container.classList.remove('hidden');
    
    // 构建长图 HTML 结构
    const exportHtml = `
        <div style="width: 800px; padding: 40px; background: #f8fafc; font-family: sans-serif;">
            <div style="text-align: center; margin-bottom: 40px;">
                <h1 style="color: #2563eb; font-size: 32px; margin-bottom: 10px;">抖音知识卡片</h1>
                <p style="color: #64748b; font-size: 18px;">让每一条视频都变成你的知识</p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 24px;">
                ${selectedCardsData.map(card => `
                    <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                        <div style="display: inline-block; background: #eff6ff; color: #2563eb; padding: 4px 12px; border-radius: 99px; font-size: 14px; margin-bottom: 12px; font-weight: bold;">
                            ${escapeHTML(card.is_integrated ? '整合' : card.category)}
                        </div>
                        <h2 style="font-size: 24px; margin-bottom: 16px; color: #0f172a;">${escapeHTML(card.title)}</h2>
                        <p style="font-size: 16px; color: #334155; margin-bottom: 16px;">${escapeHTML(card.core_point || card.summary)}</p>
                        ${card.key_points ? `
                        <ul style="padding-left: 20px; color: #475569; font-size: 15px;">
                            ${safeList(card.key_points).map(p => `<li style="margin-bottom: 8px;">${escapeHTML(p)}</li>`).join('')}
                        </ul>` : ''}
                    </div>
                `).join('')}
            </div>
            <div style="text-align: center; margin-top: 40px; color: #94a3b8; font-size: 14px;">
                Generated by Zcard
            </div>
        </div>
    `;
    
    container.innerHTML = exportHtml;
    
    try {
        if (typeof window.html2canvas !== 'function') {
            throw new Error('图片导出库加载失败，请检查网络或稍后重试');
        }
        const canvas = await html2canvas(container.firstElementChild, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f8fafc'
        });
        
        const link = document.createElement('a');
        link.download = `知识卡片导出_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
    } catch (e) {
        console.error('导出失败:', e);
        alert(`导出图片失败：${e.message || '未知错误'}`);
    } finally {
        container.classList.add('hidden');
        container.innerHTML = '';
        selectedCards.clear();
        updateBatchActions();
        renderCards();
    }
}

// 辅助函数
function saveCards() {
    try {
        localStorage.setItem('douyin_cards', JSON.stringify(cards));
    } catch (error) {
        console.error('保存卡片失败:', error);
        alert('保存失败：浏览器本地存储空间不足或不可用。');
    }
}

// 启动应用
init();
