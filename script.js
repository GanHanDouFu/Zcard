/**
 * 抖音知识卡片 - 核心逻辑 (script.js)
 */

// 全局状态
let cards = loadCards();
let currentCategory = '全部';
let currentSearch = '';
let selectedCards = new Set();
let flashcardQueue = [];
let currentFlashcardIndex = 0;
let currentActionCardId = null;
let currentReviewCardId = null;
let isEditingCard = false;

// API 配置
const API_URL = 'https://api.deepseek.com/chat/completions';
const PROXY_API_URL = '/api/deepseek';
const DEFAULT_DEMO_API_KEY = 'sk-4591f6e3f254426abe448bfc21e6d86d';
let API_KEY = sessionStorage.getItem('deepseek_api_key') || DEFAULT_DEMO_API_KEY;

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

function loadCards() {
    try {
        const parsed = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
        return Array.isArray(parsed) ? parsed : [];
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
    btnOpenNotebook: document.getElementById('btn-open-notebook'),
    modalSourceLink: document.getElementById('modal-source-link'),
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
    btnSaveSettings: document.getElementById('btn-save-settings')
};

// 当前操作的卡片 ID
let currentViewCardId = null;

// 初始化
function init() {
    refreshIcons();
    renderCards();
    renderDailyReview();
    bindEvents();
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
    
    els.btnAddTodo.addEventListener('click', handleAddTodo);
    els.btnEditCard.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentViewCardId);
        if (card) openCardDetail(card, true);
    });
    els.btnCancelEdit.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentViewCardId);
        if (card) openCardDetail(card, false);
    });
    els.btnSaveCard.addEventListener('click', saveEditedCard);
    els.btnOpenNotebook.addEventListener('click', openNotebook);
    els.btnCloseNotebook.addEventListener('click', () => els.notebookModal.classList.add('hidden'));
    els.btnSaveNotebook.addEventListener('click', saveNotebook);

    els.btnActionCancel.addEventListener('click', () => els.actionModal.classList.add('hidden'));
    els.btnActionDetail.addEventListener('click', () => {
        const card = cards.find(c => c.id === currentActionCardId);
        els.actionModal.classList.add('hidden');
        if (card) openCardDetail(card);
    });

    els.btnReviewSkip.addEventListener('click', () => completeReviewCard(false));
    els.btnReviewDo.addEventListener('click', () => completeReviewCard(true));
    
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
            if (action === 'compose') {
                document.getElementById('compose-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                els.videoInput.focus({ preventScroll: true });
            } else if (action === 'cards') {
                els.cardsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (action === 'review') {
                startFlashcardMode();
            } else if (action === 'settings') {
                els.apiKeyInput.value = API_KEY;
                els.settingsModal.classList.remove('hidden');
            }
        });
    });
}

// 渲染卡片列表
function renderCards() {
    let filtered = cards;
    
    // 1. 分类过滤
    if (currentCategory === '待办') {
        filtered = filtered.filter(c => c.is_todo);
    } else if (currentCategory !== '全部') {
        filtered = filtered.filter(c => c.category === currentCategory && !c.is_todo);
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
        cardEl.className = `knowledge-card ${card.is_integrated ? 'integrated' : ''} ${card.is_todo && card.todo_status === '已完成' ? 'todo-completed' : ''}`;
        const canIntegrate = getSameCategoryCards(card).length >= 2 && !card.is_integrated;
        
        // 阻止复选框点击事件冒泡到卡片
        const checkboxHtml = `<input type="checkbox" class="card-checkbox" data-id="${escapeHTML(card.id)}" ${selectedCards.has(card.id) ? 'checked' : ''}>`;
        
        cardEl.innerHTML = `
            <div class="card-header">
                <span class="card-badge">${escapeHTML(card.is_integrated ? '整合' : (card.is_todo ? '待办' : card.category))}</span>
                ${checkboxHtml}
            </div>
            <h3 class="card-title">${escapeHTML(card.title)}</h3>
            <p class="card-core">${escapeHTML(card.core_point || card.summary || '')}</p>
            <div class="card-footer">
                <span>${escapeHTML(card.created_at)}</span>
                ${canIntegrate ? '<span class="merge-hint">可整合</span>' : ''}
                ${card.is_todo ? `<button class="btn btn-text btn-toggle-todo" data-id="${escapeHTML(card.id)}">${card.todo_status === '已完成' ? '撤销' : '完成'}</button>` : ''}
            </div>
        `;
        
        // 卡片点击事件 (打开详情)
        cardEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('card-checkbox') || e.target.classList.contains('btn-toggle-todo')) return;
            openCardActions(card);
        });
        
        // 复选框点击事件
        const checkbox = cardEl.querySelector('.card-checkbox');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedCards.add(card.id);
            } else {
                selectedCards.delete(card.id);
            }
            updateBatchActions();
        });
        
        // 待办完成切换
        const todoBtn = cardEl.querySelector('.btn-toggle-todo');
        if (todoBtn) {
            todoBtn.addEventListener('click', () => {
                card.todo_status = card.todo_status === '已完成' ? '未完成' : '已完成';
                saveCards();
                renderCards();
            });
        }
        
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
    return `
        <article class="knowledge-card search-result-card" data-id="${escapeHTML(card.id)}">
            <div class="card-header">
                <span class="card-badge">${escapeHTML(card.category || '未分类')}</span>
            </div>
            <h3 class="card-title">${escapeHTML(card.title)}</h3>
            <p class="card-core">${escapeHTML(card.core_point || card.summary || '')}</p>
        </article>
    `;
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
    const available = cards.filter(card => !card.is_todo && !card.is_integrated && card.reviewed_on !== today);
    if (available.length === 0) {
        currentReviewCardId = null;
        els.reviewSection.classList.add('hidden');
        return;
    }
    const index = Math.floor(Math.random() * available.length);
    const card = available[index];
    currentReviewCardId = card.id;
    els.reviewTitle.textContent = card.title || '知识复习';
    els.reviewCore.textContent = card.core_point || card.summary || '打开一张卡片，回忆它的核心观点。';
    els.reviewCard.classList.remove('shattering');
    els.reviewSection.classList.remove('hidden');
}

function completeReviewCard(withEffect) {
    const card = cards.find(c => c.id === currentReviewCardId);
    if (!card) return;
    const finish = () => {
        card.reviewed_on = todayKey();
        saveCards();
        renderDailyReview();
    };
    if (withEffect) {
        els.reviewCard.classList.add('shattering');
        setTimeout(finish, 900);
    } else {
        finish();
    }
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
    
    let contentHtml = '';
    
    if (editMode) {
        contentHtml = renderCardEditForm(card);
    } else
    if (card.is_integrated) {
        // 整合卡片布局
        contentHtml = `
            <span class="detail-badge">整合卡片</span>
            <h2 class="detail-title">${escapeHTML(card.title)}</h2>
            <div class="detail-section">
                <h4>综合观点</h4>
                <p>${escapeHTML(card.summary)}</p>
            </div>
            <div class="detail-section">
                <h4>多角度分析</h4>
                <ul>
                    ${safeList(card.angles).map(a => `<li>${escapeHTML(a)}</li>`).join('')}
                </ul>
            </div>
            <div class="quote-section">
                <strong>关键结论：</strong>${escapeHTML(card.conclusion)}
            </div>
            ${card.note ? renderNoteSection(card.note) : ''}
        `;
    } else {
        // 普通卡片/待办卡片布局
        contentHtml = `
            <span class="detail-badge">${escapeHTML(card.category)}</span>
            <h2 class="detail-title">${escapeHTML(card.title)}</h2>
            <div class="detail-section">
                <h4>核心观点</h4>
                <p>${escapeHTML(card.core_point)}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <ul>
                    ${safeList(card.key_points).map(p => `<li>${escapeHTML(p)}</li>`).join('')}
                </ul>
            </div>
            ${card.quote ? `<div class="quote-section">"${escapeHTML(card.quote)}"</div>` : ''}
            ${card.action ? `
            <div class="detail-section">
                <h4>行动建议</h4>
                <p>${escapeHTML(card.action)}</p>
            </div>` : ''}
            ${card.note ? renderNoteSection(card.note) : ''}
        `;
    }
    
    els.modalBody.innerHTML = contentHtml;
    
    // 原视频链接按钮
    const sourceUrl = safeUrl(card.video_link);
    if (sourceUrl) {
        els.modalSourceLink.href = sourceUrl;
        els.modalSourceLink.classList.remove('hidden');
    } else {
        els.modalSourceLink.removeAttribute('href');
        els.modalSourceLink.classList.add('hidden');
    }
    
    // 待办按钮控制
    if (card.is_todo || card.is_integrated) {
        els.btnAddTodo.classList.add('hidden');
    } else {
        els.btnAddTodo.classList.remove('hidden');
    }

    els.btnEditCard.classList.toggle('hidden', editMode);
    els.btnOpenNotebook.classList.toggle('hidden', editMode);
    els.btnSaveCard.classList.toggle('hidden', !editMode);
    els.btnCancelEdit.classList.toggle('hidden', !editMode);
    els.btnDeleteCard.classList.toggle('hidden', editMode);
    els.modalSourceLink.classList.toggle('hidden', editMode || !sourceUrl);
    
    els.cardModal.classList.remove('hidden');
    refreshIcons();
}

function renderCardEditForm(card) {
    return `
        <span class="detail-badge">编辑卡片</span>
        <div class="edit-form">
            <label>标题<input id="edit-title" value="${escapeHTML(card.title)}"></label>
            <label>领域<input id="edit-category" value="${escapeHTML(card.category || '')}"></label>
            <label>核心观点<textarea id="edit-core">${escapeHTML(card.core_point || card.summary || '')}</textarea></label>
            <label>关键要点<textarea id="edit-points">${escapeHTML(safeList(card.key_points).join('\n'))}</textarea></label>
            <label>金句<textarea id="edit-quote">${escapeHTML(card.quote || '')}</textarea></label>
            <label>行动建议<textarea id="edit-action">${escapeHTML(card.action || '')}</textarea></label>
            <label>视频链接<input id="edit-link" value="${escapeHTML(card.video_link || '')}"></label>
        </div>
    `;
}

function renderNoteSection(note) {
    return `
        <div class="detail-section note-section">
            <h4>记事本内容</h4>
            <p>${escapeHTML(note)}</p>
        </div>
    `;
}

function saveEditedCard() {
    const card = cards.find(c => c.id === currentViewCardId);
    if (!card) return;
    card.title = document.getElementById('edit-title').value.trim() || card.title;
    card.category = document.getElementById('edit-category').value.trim() || '未分类';
    card.core_point = document.getElementById('edit-core').value.trim();
    card.key_points = document.getElementById('edit-points').value.split('\n').map(p => p.trim()).filter(Boolean);
    card.quote = document.getElementById('edit-quote').value.trim();
    card.action = document.getElementById('edit-action').value.trim();
    card.video_link = document.getElementById('edit-link').value.trim();
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

// 加入待办功能
function handleAddTodo() {
    const sourceCard = cards.find(c => c.id === currentViewCardId);
    if (!sourceCard) return;
    
    const todoCard = {
        id: 'todo_' + Date.now(),
        title: `[待办] ${sourceCard.title}`,
        core_point: sourceCard.action || sourceCard.core_point,
        key_points: sourceCard.key_points,
        category: sourceCard.category,
        video_link: sourceCard.video_link,
        created_at: new Date().toISOString().split('T')[0],
        is_todo: true,
        todo_status: '未完成'
    };
    
    cards.unshift(todoCard);
    saveCards();
    alert('已成功加入待办！');
    els.cardModal.classList.add('hidden');
    renderCards();
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
        is_local: true
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
        is_integrated: false
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

// 整合卡片
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
        
        const integratedCard = {
            id: 'int_' + Date.now(),
            ...result,
            summary: result.summary || result.scenario || result.core_point,
            core_point: result.core_point || result.summary || result.scenario,
            category: isCrossCategory ? '揉杂' : selectedCardsData[0].category,
            created_at: new Date().toISOString().split('T')[0],
            is_todo: false,
            is_integrated: true,
            source_links: selectedCardsData.map(c => c.video_link).filter(Boolean)
        };
        
        if (!isCrossCategory) {
            cards = cards.filter(c => !selectedCards.has(c.id));
        }
        cards.unshift(integratedCard);
        saveCards();
        
        selectedCards.clear();
        updateBatchActions();
        renderCards();
        
    } catch (e) {
        alert(`整合失败：${e.message || '请检查 API Key 或网络连接'}`);
    } finally {
        els.loadingIndicator.classList.add('hidden');
        els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    }
}

// 复习闪卡模式
function startFlashcardMode() {
    // 过滤出当前分类下的卡片（非整合，非待办）
    flashcardQueue = cards.filter(c => !c.is_integrated && !c.is_todo);
    if (currentCategory !== '全部') {
        flashcardQueue = flashcardQueue.filter(c => c.category === currentCategory);
    }
    
    if (flashcardQueue.length === 0) {
        alert('当前分类下没有可复习的卡片！');
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
