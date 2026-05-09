/**
 * 抖音知识卡片 - 核心逻辑 (script.js)
 */

// 初始化 Lucide 图标
lucide.createIcons();

// 全局状态
let cards = JSON.parse(localStorage.getItem('douyin_cards') || '[]');
let currentCategory = '全部';
let currentSearch = '';
let selectedCards = new Set();
let flashcardQueue = [];
let currentFlashcardIndex = 0;

// API 配置
const API_URL = 'https://api.deepseek.com/chat/completions';
let API_KEY = localStorage.getItem('deepseek_api_key') || '';

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
    
    // Modals
    cardModal: document.getElementById('card-modal'),
    modalBody: document.getElementById('modal-card-body'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnDeleteCard: document.getElementById('btn-delete-card'),
    btnAddTodo: document.getElementById('btn-add-todo'),
    modalSourceLink: document.getElementById('modal-source-link'),
    
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
    renderCards();
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
        renderCards();
    });
    
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
        }
    });
    
    els.btnAddTodo.addEventListener('click', handleAddTodo);
    
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
        localStorage.setItem('deepseek_api_key', API_KEY);
        els.settingsModal.classList.add('hidden');
        alert('API Key 已保存');
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
    
    // 2. 领域内搜索过滤
    if (currentSearch) {
        filtered = filtered.filter(c => {
            const titleMatch = (c.title || '').toLowerCase().includes(currentSearch);
            const coreMatch = (c.core_point || '').toLowerCase().includes(currentSearch);
            const pointsMatch = (c.key_points || []).join(' ').toLowerCase().includes(currentSearch);
            return titleMatch || coreMatch || pointsMatch;
        });
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
        
        // 阻止复选框点击事件冒泡到卡片
        const checkboxHtml = `<input type="checkbox" class="card-checkbox" data-id="${card.id}" ${selectedCards.has(card.id) ? 'checked' : ''}>`;
        
        cardEl.innerHTML = `
            <div class="card-header">
                <span class="card-badge">${card.is_integrated ? '整合' : (card.is_todo ? '待办' : card.category)}</span>
                ${checkboxHtml}
            </div>
            <h3 class="card-title">${card.title}</h3>
            <p class="card-core">${card.core_point || card.summary || ''}</p>
            <div class="card-footer">
                <span>${card.created_at}</span>
                ${card.is_todo ? `<button class="btn btn-text btn-toggle-todo" data-id="${card.id}">${card.todo_status === '已完成' ? '撤销' : '完成'}</button>` : ''}
            </div>
        `;
        
        // 卡片点击事件 (打开详情)
        cardEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('card-checkbox') || e.target.classList.contains('btn-toggle-todo')) return;
            openCardDetail(card);
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

// 打开卡片详情
function openCardDetail(card) {
    currentViewCardId = card.id;
    
    let contentHtml = '';
    
    if (card.is_integrated) {
        // 整合卡片布局
        contentHtml = `
            <span class="detail-badge">整合卡片</span>
            <h2 class="detail-title">${card.title}</h2>
            <div class="detail-section">
                <h4>综合观点</h4>
                <p>${card.summary}</p>
            </div>
            <div class="detail-section">
                <h4>多角度分析</h4>
                <ul>
                    ${(card.angles || []).map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>
            <div class="quote-section">
                <strong>关键结论：</strong>${card.conclusion}
            </div>
        `;
    } else {
        // 普通卡片/待办卡片布局
        contentHtml = `
            <span class="detail-badge">${card.category}</span>
            <h2 class="detail-title">${card.title}</h2>
            <div class="detail-section">
                <h4>核心观点</h4>
                <p>${card.core_point}</p>
            </div>
            <div class="detail-section">
                <h4>关键要点</h4>
                <ul>
                    ${(card.key_points || []).map(p => `<li>${p}</li>`).join('')}
                </ul>
            </div>
            ${card.quote ? `<div class="quote-section">"${card.quote}"</div>` : ''}
            ${card.action ? `
            <div class="detail-section">
                <h4>行动建议</h4>
                <p>${card.action}</p>
            </div>` : ''}
        `;
    }
    
    els.modalBody.innerHTML = contentHtml;
    
    // 原视频链接按钮
    if (card.video_link) {
        els.modalSourceLink.href = card.video_link;
        els.modalSourceLink.classList.remove('hidden');
    } else {
        els.modalSourceLink.classList.add('hidden');
    }
    
    // 待办按钮控制
    if (card.is_todo || card.is_integrated) {
        els.btnAddTodo.classList.add('hidden');
    } else {
        els.btnAddTodo.classList.remove('hidden');
    }
    
    els.cardModal.classList.remove('hidden');
    lucide.createIcons();
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
    if (!API_KEY) {
        alert('请先点击右上角设置图标配置 DeepSeek API Key！');
        throw new Error('No API Key');
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' } // 强制 JSON 返回
            })
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        let content = data.choices[0].message.content;
        
        // 尝试解析 JSON，处理可能的 markdown 包装
        if (content.startsWith('```json')) {
            content = content.replace(/```json\n?/, '').replace(/```$/, '');
        }
        return JSON.parse(content);
        
    } catch (error) {
        console.error(error);
        alert('AI 生成失败，请检查 API Key 或网络连接。');
        throw error;
    }
}

// 模拟获取链接内容的辅助函数（支持抖音和新闻链接模拟，用于黑客松演示）
async function mockFetchTranscript(url, index = 0) {
    let mockText = "";
    
    // 简单的模拟逻辑：判断URL中是否包含特定关键字
    if (url.includes('news') || url.includes('article') || url.includes('163')) {
        const newsMockTranscripts = [
            `这是从新闻链接 ${url} 提取的文章内容：\n最新经济数据显示，今年一季度AI相关产业投资增长超过40%。专家指出，生成式AI不仅在科技圈火爆，更开始实质性地改变传统行业的生产流程，提升效率。`,
            `这是从新闻链接 ${url} 提取的文章内容：\n多地出台新政策鼓励年轻人创业。政策主要集中在减免税收、提供低息贷款以及设立专项的创业孵化园区。政府希望以此激发市场活力。`
        ];
        mockText = newsMockTranscripts[index % newsMockTranscripts.length];
    } else {
        const douyinMockTranscripts = [
            `这是从抖音链接 ${url} 提取的视频文案：\n大家好，今天给大家分享一个职场技巧。在汇报工作时，一定要遵循“结论先行”的原则。不要长篇大论说过程，领导只关心结果。第一步，先抛出你的核心结论；第二步，说明支撑结论的数据。`,
            `这是从抖音链接 ${url} 提取的视频文案：\n为什么你的汇报领导总是不满意？因为你没有带着“方案”去汇报。遇到问题，不仅要说问题，还要给领导提供至少两个选择，并附上你推荐的方案。这叫带着思考工作。`,
            `这是从抖音链接 ${url} 提取的视频文案：\n职场沟通中，情绪价值很重要。汇报坏消息时，先说你的应对措施，再说坏消息，最后表明需要什么帮助。这样领导觉得你是有担当的，而不是甩锅。`
        ];
        mockText = douyinMockTranscripts[index % douyinMockTranscripts.length];
    }

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(mockText);
        }, 1000); // 稍微缩短时间，因为如果有多个链接会叠加
    });
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
    
    // 如果文本中包含多个链接，我们将其视为需要融合的多个信息源
    // 即使文本中包含其他文字（如分享文案），只要有多个链接，我们就触发多源融合逻辑
    let isMultiVideo = linkMatches.length > 1;

    // 为了黑客松演示，如果只输入了链接（没有太多其他文字），我们用模拟文本替换它
    let isMostlyLinks = false;
    let linksLength = linkMatches.reduce((acc, link) => acc + link.length, 0);
    if (linkMatches.length > 0 && text.length < linksLength + 150) { // 放宽一点限制，允许带有长分享文案
        isMostlyLinks = true;
    }

    if (isMostlyLinks && linkMatches.length > 0) {
        els.loadingIndicator.querySelector('span').textContent = `正在解析 ${linkMatches.length} 个链接内容...`;
        
        let combinedTranscripts = [];
        for (let i = 0; i < linkMatches.length; i++) {
            const transcript = await mockFetchTranscript(linkMatches[i], i);
            combinedTranscripts.push(`【信息源 ${i+1}】\n${transcript}`);
        }
        // 如果用户原本输入里还有一些文字，我们把它也保留作为上下文
        const userTextWithoutLinks = text.replace(/https?:\/\/[^\s]+/g, '').trim();
        text = (userTextWithoutLinks ? `【用户原始输入描述】\n${userTextWithoutLinks}\n\n` : '') + combinedTranscripts.join('\n\n');
    }
    
    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您提炼知识...';
    
    let prompt = "";
    
    // 再次确认是否是多源融合（文本中是否已经被打上了信息源的标记，或者原本就有很多链接）
    if (isMultiVideo || text.includes('【信息源 2】')) {
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

    try {
        const result = await callDeepSeek(prompt);
        
        const newCard = {
            id: 'card_' + Date.now(),
            ...result,
            video_link: videoLink,
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
        
    } catch (e) {
        // Error already handled in callDeepSeek
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
    
    els.loadingIndicator.querySelector('span').textContent = 'AI 正在为您整合多重视角...';
    els.loadingIndicator.classList.remove('hidden');
    
    const prompt = `你是一个知识整合专家。以下是关于同一事件/主题的多个视频分析卡片，请整合成一张汇总卡片。

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
            category: selectedCardsData[0].category, // 继承第一个卡片的分类
            created_at: new Date().toISOString().split('T')[0],
            is_todo: false,
            is_integrated: true,
            source_links: selectedCardsData.map(c => c.video_link).filter(Boolean)
        };
        
        cards.unshift(integratedCard);
        saveCards();
        
        selectedCards.clear();
        updateBatchActions();
        renderCards();
        
    } catch (e) {
        // Error handled
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
    els.fcPoints.innerHTML = (card.key_points || []).map(p => `<li>${p}</li>`).join('');
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
                            ${card.is_integrated ? '整合' : card.category}
                        </div>
                        <h2 style="font-size: 24px; margin-bottom: 16px; color: #0f172a;">${card.title}</h2>
                        <p style="font-size: 16px; color: #334155; margin-bottom: 16px;">${card.core_point || card.summary}</p>
                        ${card.key_points ? `
                        <ul style="padding-left: 20px; color: #475569; font-size: 15px;">
                            ${card.key_points.map(p => `<li style="margin-bottom: 8px;">${p}</li>`).join('')}
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
        alert('导出图片失败');
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
    localStorage.setItem('douyin_cards', JSON.stringify(cards));
}

// 启动应用
init();
