/**
 * Главный SPA контроллер приложения (Лабораторная работа №3)
 */

let allTasks = [];
let allUsers = [];
let currentFilter = 'all';
let searchQuery = '';
let flatpickrCreate = null;
let flatpickrEdit = null;

/**
 * Мгновенное восстановление интерфейса из кэша (0ms, устранение мерцания при F5)
 */
function hydrateFromCache() {
    const savedUser = localStorage.getItem('user_info');
    const token = ApiClient.getAccessToken();
    const savedTasks = localStorage.getItem('cached_tasks');
    const savedUsers = localStorage.getItem('cached_users');

    if (savedUser && token) {
        try {
            currentUser = JSON.parse(savedUser);
            document.documentElement.classList.add('is-auth');
            if (currentUser.role) {
                document.documentElement.classList.add('role-' + currentUser.role);
            }
            if (typeof updateAuthUI === 'function') {
                updateAuthUI();
            }

            if (savedUsers && typeof populateUserSelects === 'function') {
                try {
                    populateUserSelects(JSON.parse(savedUsers));
                } catch {}
            }

            const draftExec = localStorage.getItem('draft_executor');
            const draftRev = localStorage.getItem('draft_reviewer');
            const execSel = document.getElementById('task-executor');
            const revSel = document.getElementById('task-reviewer');
            if (draftExec && execSel) execSel.value = draftExec;
            if (draftRev && revSel) revSel.value = draftRev;

            if (savedTasks) {
                allTasks = JSON.parse(savedTasks);
                renderTasks(allTasks);
                if (typeof updateCountersFromTasks === 'function') {
                    updateCountersFromTasks(allTasks);
                }
            }
        } catch (e) {
            console.warn('Cache hydration error:', e);
        }
    }
}

// Инициализация при загрузке документа
document.addEventListener('DOMContentLoaded', async () => {
    hydrateFromCache();
    initDatepickers();
    setupEventListeners();

    if (currentUser) {
        // Параллельное фоновое обновление данных без мерцания (Background Revalidation)
        await Promise.all([
            initAuth(),
            loadUsers(),
            loadTasks(false)
        ]);
    } else {
        await initAuth();
        if (currentUser) {
            await Promise.all([
                loadUsers(),
                loadTasks(true)
            ]);
        } else {
            resetAppState();
            renderTasks([]);
        }
    }
});

/**
 * Инициализация календарей Flatpickr
 */
function initDatepickers() {
    if (window.flatpickr) {
        flatpickrCreate = flatpickr('#task-dueDate', {
            locale: 'ru',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'j F Y',
            minDate: 'today'
        });

        flatpickrEdit = flatpickr('#edit-dueDate', {
            locale: 'ru',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'j F Y'
        });

        document.getElementById('btn-clear-date')?.addEventListener('click', () => {
            if (flatpickrCreate) flatpickrCreate.clear();
        });
    }
}

/**
 * Регистрация слушателей событий
 */
function setupEventListeners() {
    // Формы авторизации
    document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
    document.getElementById('register-form')?.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('forgot-form')?.addEventListener('submit', handleForgotSubmit);
    document.getElementById('reset-password-form')?.addEventListener('submit', handleResetPasswordSubmit);
    document.getElementById('change-password-form')?.addEventListener('submit', handleChangePasswordSubmit);

    // Формы задач
    document.getElementById('create-task-form')?.addEventListener('submit', handleCreateTask);
    document.getElementById('edit-task-form')?.addEventListener('submit', handleEditTask);
    document.getElementById('review-task-form')?.addEventListener('submit', handleReviewTask);
    document.getElementById('submit-report-form')?.addEventListener('submit', handleSubmitReportForm);

    document.getElementById('btn-confirm-delete')?.addEventListener('click', handleConfirmDelete);
    document.getElementById('btn-reset-form')?.addEventListener('click', resetCreateForm);

    // Авто-сохранение выбранного исполнителя и проверяющего в форме создания задачи
    document.getElementById('task-executor')?.addEventListener('change', (e) => {
        if (e.target.value) {
            localStorage.setItem('draft_executor', e.target.value);
        } else {
            localStorage.removeItem('draft_executor');
        }
    });

    document.getElementById('task-reviewer')?.addEventListener('change', (e) => {
        if (e.target.value) {
            localStorage.setItem('draft_reviewer', e.target.value);
        } else {
            localStorage.removeItem('draft_reviewer');
        }
    });

    // Фильтры по статусам
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            currentFilter = target.getAttribute('data-filter');
            loadTasks();
        });
    });

    // Живой поиск
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');

    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        searchQuery = e.target.value;
        if (btnClearSearch) btnClearSearch.style.display = searchQuery ? 'block' : 'none';
        debounceTimer = setTimeout(() => {
            loadTasks();
        }, 300);
    });

    btnClearSearch?.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        btnClearSearch.style.display = 'none';
        loadTasks();
    });
}

/**
 * Заполнение выпадающих списков пользователей по ролям (Исполнители / Проверяющие)
 */
function populateUserSelects(users) {
    if (!users || !Array.isArray(users)) return;

    const execSelect = document.getElementById('task-executor');
    const revSelect = document.getElementById('task-reviewer');
    const editExecSelect = document.getElementById('edit-executor');
    const editRevSelect = document.getElementById('edit-reviewer');

    // Сохраняем текущие выбранные значения или сохраненные черновики
    const selectedExec = execSelect?.value || localStorage.getItem('draft_executor') || '';
    const selectedRev = revSelect?.value || localStorage.getItem('draft_reviewer') || '';
    const selectedEditExec = editExecSelect?.value || '';
    const selectedEditRev = editRevSelect?.value || '';

    // Строгая фильтрация по ролям:
    // В качестве исполнителей — только пользователи с ролью "executor" (Исполнитель)
    const executorUsers = users.filter(u => u.role === 'executor');
    const executorOptions = executorUsers.length > 0
        ? executorUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (Исполнитель)</option>`).join('')
        : '<option value="" disabled>Нет пользователей с ролью Исполнитель</option>';

    // В качестве проверяющих — только пользователи с ролью "reviewer" (Проверяющий)
    const reviewerUsers = users.filter(u => u.role === 'reviewer');
    const reviewerOptions = reviewerUsers.length > 0
        ? reviewerUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (Проверяющий)</option>`).join('')
        : '<option value="" disabled>Нет пользователей с ролью Проверяющий</option>';

    if (execSelect) {
        execSelect.innerHTML = '<option value="">-- Не назначен --</option>' + executorOptions;
        if (selectedExec) execSelect.value = selectedExec;
    }
    if (editExecSelect) {
        editExecSelect.innerHTML = '<option value="">-- Не назначен --</option>' + executorOptions;
        if (selectedEditExec) editExecSelect.value = selectedEditExec;
    }

    if (revSelect) {
        revSelect.innerHTML = '<option value="">-- Не назначен --</option>' + reviewerOptions;
        if (selectedRev) revSelect.value = selectedRev;
    }
    if (editRevSelect) {
        editRevSelect.innerHTML = '<option value="">-- Не назначен --</option>' + reviewerOptions;
        if (selectedEditRev) editRevSelect.value = selectedEditRev;
    }
}
window.populateUserSelects = populateUserSelects;

/**
 * Загрузка пользователей из БД для назначения исполнителей и проверяющих
 */
async function loadUsers() {
    if (!currentUser) return;
    try {
        const res = await ApiClient.get('/api/auth/users');
        allUsers = res.data || [];
        try { localStorage.setItem('cached_users', JSON.stringify(allUsers)); } catch {}
        populateUserSelects(allUsers);
    } catch (e) {
        console.warn('Ошибка загрузки пользователей:', e);
    }
}
window.loadUsers = loadUsers;

/**
 * Сброс счетчиков задач на 0
 */
function resetCounters() {
    ['all', 'pending', 'in_progress', 'in_review', 'completed', 'rejected'].forEach(k => {
        const el = document.getElementById(`count-${k}`);
        if (el) el.textContent = '0';
    });
}
window.resetCounters = resetCounters;

/**
 * Сброс состояния задач при выходе из системы или неавторизованном доступе
 */
function resetAppState() {
    allTasks = [];
    allUsers = [];
    currentFilter = 'all';
    searchQuery = '';
    try { localStorage.removeItem('cached_tasks'); } catch {}
    document.documentElement.classList.remove('is-auth');

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const btnClearSearch = document.getElementById('btn-clear-search');
    if (btnClearSearch) btnClearSearch.style.display = 'none';

    document.querySelectorAll('.filter-tab').forEach(t => {
        if (t.getAttribute('data-filter') === 'all') {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });

    resetCounters();
}
window.resetAppState = resetAppState;

/**
 * Загрузка задач с сервера (как во 2 ЛР: со сбалансированным спиннером и авто-обновлением счетчиков)
 */
async function loadTasks(isInitial = false) {
    if (!currentUser) {
        resetAppState();
        renderTasks([]);
        return;
    }

    const spinner = document.getElementById('loading-spinner');
    if (isInitial && allTasks.length === 0 && spinner) {
        spinner.style.display = 'block';
    }

    try {
        const params = {};
        if (currentFilter !== 'all') params.status = currentFilter;
        if (searchQuery) params.search = searchQuery;

        const res = await ApiClient.get('/api/tasks', params);
        allTasks = res.data || [];

        // Кэшируем полный список задач для мгновенной загрузки без мерцания при следующем F5
        if (currentFilter === 'all' && !searchQuery) {
            try { localStorage.setItem('cached_tasks', JSON.stringify(allTasks)); } catch {}
        }

        renderTasks(allTasks);
        await updateCounters();
    } catch (err) {
        showGlobalAlert(err.message);
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}
window.loadTasks = loadTasks;

/**
 * Расчет счетчиков задач по статусам
 */
function updateCountersFromTasks(taskList) {
    const counts = {
        all: taskList.length,
        pending: 0,
        in_progress: 0,
        in_review: 0,
        completed: 0,
        rejected: 0
    };

    taskList.forEach(t => {
        if (counts[t.status] !== undefined) counts[t.status]++;
    });

    Object.keys(counts).forEach(k => {
        const el = document.getElementById(`count-${k}`);
        if (el) el.textContent = counts[k];
    });
}
window.updateCountersFromTasks = updateCountersFromTasks;

/**
 * Подсчет счетчиков по вкладкам статусов (как во 2 ЛР: запрашивает полный список без фильтра статуса)
 */
async function updateCounters() {
    if (!currentUser) {
        resetCounters();
        return;
    }

    // Если находимся на вкладке "Все" и поиск не активен, задачи уже загружены локально!
    if (currentFilter === 'all' && !searchQuery && allTasks && allTasks.length > 0) {
        updateCountersFromTasks(allTasks);
        return;
    }

    try {
        const params = {};
        if (searchQuery) params.search = searchQuery;

        const res = await ApiClient.get('/api/tasks', params);
        const fullTasks = res.data || [];
        updateCountersFromTasks(fullTasks);
    } catch (err) {
        console.warn('Не удалось обновить счетчики:', err);
    }
}

/**
 * Создание DOM-элемента карточки задачи с анимацией появления
 */
function createTaskElement(t) {
    const li = document.createElement('li');
    li.className = `task-item status-${t.status}`;
    li.id = `task-${t.id}`;
    li.dataset.id = t.id;
    const roleKey = `${currentUser ? currentUser.role : 'guest'}_${currentUser ? currentUser.id : 0}`;
    li.dataset.rawKey = `${roleKey}_${JSON.stringify(t)}`;

    const statusLabels = {
        pending: 'Ожидает',
        in_progress: 'В работе',
        in_review: 'На проверке',
        completed: 'Завершено',
        rejected: 'На доработке'
    };

    const role = currentUser ? currentUser.role : '';
    const creatorName = t.creator ? t.creator.name : 'Дмитрий Ковалев';
    const execName = t.executor ? t.executor.name : '<span style="color:#94a3b8">Не назначен</span>';
    const revName = t.reviewer ? t.reviewer.name : '<span style="color:#94a3b8">Не назначен</span>';
    const dueDate = t.dueDate ? new Date(t.dueDate).toLocaleDateString('ru-RU') : 'Бессрочно';

    // Формирование кнопок в зависимости от роли (RBAC)
    let actionsHtml = '';

    if (role === 'manager') {
        // Руководитель: редактирование и удаление
        actionsHtml = `
            <button class="btn btn-sm btn-secondary" onclick="openEditModal(${t.id})">✏️ Редактировать</button>
            <button class="btn btn-sm btn-danger" onclick="openDeleteModal(${t.id}, '${escapeHtml(t.title)}')">🗑️ Удалить</button>
        `;
    } else if (role === 'executor') {
        // Исполнитель: взятие в работу и сдача на проверку с прикреплением отчета
        if (t.status === 'pending') {
            actionsHtml = `<button class="btn btn-sm btn-primary" onclick="patchTaskStatus(${t.id}, 'in_progress')">▶️ Взять в работу</button>`;
        } else if (t.status === 'in_progress') {
            actionsHtml = `<button class="btn btn-sm btn-warning" onclick="openSubmitReportModal(${t.id}, '${escapeHtml(t.title)}')">📤 Сдать на проверку</button>`;
        } else if (t.status === 'rejected') {
            actionsHtml = `<button class="btn btn-sm btn-primary" onclick="patchTaskStatus(${t.id}, 'in_progress')">🛠️ Взять на исправление</button>`;
        }
    } else if (role === 'reviewer') {
        // Проверяющий: проверка и утверждение/отклонение
        if (t.status === 'in_review') {
            actionsHtml = `<button class="btn btn-sm btn-primary" onclick="openReviewModal(${t.id}, '${escapeHtml(t.title)}')">🔍 Проверить работу</button>`;
        }
    }

    li.innerHTML = `
        <div class="task-item-header">
            <div class="task-title-area">
                <span class="task-id">#${t.id}</span>
                <h3 class="task-title">${escapeHtml(t.title)}</h3>
            </div>
            <span class="status-badge ${t.status}">${statusLabels[t.status] || t.status}</span>
        </div>

        ${t.description ? `<p class="task-desc">${escapeHtml(t.description)}</p>` : ''}

        <div class="task-meta-grid">
            <span class="meta-item">📅 Срок: <strong>${dueDate}</strong></span>
            <span class="meta-item">👔 Создал: <strong>${escapeHtml(creatorName)}</strong></span>
            <span class="meta-item">🔨 Исполнитель: <strong>${execName}</strong></span>
            <span class="meta-item">🔍 Проверяющий: <strong>${revName}</strong></span>
        </div>

        ${t.reportComment ? `
            <div class="task-report-box">
                <strong>📦 Отчет исполнителя:</strong> ${escapeHtml(t.reportComment)}
            </div>
        ` : ''}

        ${t.reviewComment ? `
            <div class="task-comment-box">
                <strong>Замечания проверяющего:</strong> ${escapeHtml(t.reviewComment)}
            </div>
        ` : ''}

        <div class="task-item-footer">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                ${t.attachment ? `
                    <a href="${t.attachment.downloadUrl}" class="task-attachment-link" target="_blank" download="${escapeHtml(fixFilenameEncoding(t.attachment.originalName))}">
                        📎 ТЗ: ${escapeHtml(fixFilenameEncoding(t.attachment.originalName) || 'Вложение')}
                    </a>
                ` : ''}
                ${t.reportAttachment ? `
                    <a href="${t.reportAttachment.downloadUrl}" class="task-report-link" target="_blank" download="${escapeHtml(fixFilenameEncoding(t.reportAttachment.originalName))}">
                        📦 Отчет: ${escapeHtml(fixFilenameEncoding(t.reportAttachment.originalName) || 'Отчет')}
                    </a>
                ` : ''}
            </div>
            <div class="task-actions">
                ${actionsHtml}
            </div>
        </div>
    `;

    return li;
}

/**
 * Отрисовка списка задач в DOM без мерцания и с сохранением неизмененных нод (как во 2 ЛР)
 */
function renderTasks(tasks) {
    const listEl = document.getElementById('task-list');
    const emptyState = document.getElementById('empty-state');
    const emptyIcon = document.getElementById('empty-icon') || emptyState?.querySelector('.empty-icon');
    const emptyTitle = document.getElementById('empty-title') || emptyState?.querySelector('.empty-title');
    const emptySubtitle = document.getElementById('empty-subtitle') || emptyState?.querySelector('.empty-subtitle');

    if (!listEl) return;

    if (!currentUser) {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'block';
            if (emptyIcon) emptyIcon.textContent = '🔒';
            if (emptyTitle) emptyTitle.textContent = 'Требуется авторизация';
            if (emptySubtitle) {
                emptySubtitle.innerHTML = `
                    <p style="margin-bottom: 16px; color: var(--gray-600); font-size: 14px;">
                        Для просмотра задач и работы с проектом выполните вход под нужной ролью (Руководитель, Исполнитель, Проверяющий) или зарегистрируйтесь.
                    </p>
                    <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                        <button type="button" class="btn btn-primary" onclick="openLoginModal()">
                            🔐 Войти в систему
                        </button>
                        <button type="button" class="btn btn-outline-primary" onclick="openRegisterModal()">
                            📝 Регистрация
                        </button>
                    </div>
                `;
            }
        }
        return;
    }

    if (!tasks || tasks.length === 0) {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'block';
            if (emptyIcon) emptyIcon.textContent = '📭';
            if (emptyTitle) emptyTitle.textContent = 'Задачи не найдены';
            if (emptySubtitle) {
                emptySubtitle.innerHTML = '<p style="color: var(--gray-600); font-size: 14px;">Создайте новую задачу или измените параметры фильтра.</p>';
            }
        }
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    listEl.style.display = 'flex';

    // Индексируем существующие карточки задач для атомарного диффинга без мерцания (как во 2 ЛР)
    const existingMap = new Map();
    listEl.querySelectorAll('.task-item').forEach(el => {
        existingMap.set(Number(el.dataset.id), el);
    });

    const roleKey = `${currentUser ? currentUser.role : 'guest'}_${currentUser ? currentUser.id : 0}`;
    const newNodes = tasks.map(task => {
        const existing = existingMap.get(task.id);
        if (existing && existing.dataset.rawKey === `${roleKey}_${JSON.stringify(task)}`) {
            return existing;
        }
        return createTaskElement(task);
    });

    // Атомарное обновление DOM-дерева списка задач без белого экрана
    listEl.replaceChildren(...newNodes);
}

/**
 * Создание новой задачи Руководителем
 */
async function handleCreateTask(e) {
    e.preventDefault();
    const form = e.target;
    const errorBox = document.getElementById('form-validation-errors');
    if (errorBox) errorBox.style.display = 'none';

    const formData = new FormData(form);

    try {
        await ApiClient.post('/api/tasks', formData);
        showToast('Задача успешно создана и назначена!', 'success');
        resetCreateForm();
        await loadTasks();
    } catch (err) {
        let msg = err.message;
        if (err.errors && err.errors.length) {
            msg = err.errors.map(e => e.message).join('; ');
        }
        if (errorBox) {
            errorBox.textContent = msg;
            errorBox.style.display = 'block';
        } else {
            showToast(msg, 'error');
        }
    }
}

function resetCreateForm() {
    const form = document.getElementById('create-task-form');
    if (form) form.reset();
    if (flatpickrCreate) flatpickrCreate.clear();
    const errBox = document.getElementById('form-validation-errors');
    if (errBox) errBox.style.display = 'none';
    try {
        localStorage.removeItem('draft_executor');
        localStorage.removeItem('draft_reviewer');
    } catch {}
}

/**
 * Быстрое изменение статуса (PATCH)
 */
async function patchTaskStatus(taskId, newStatus) {
    try {
        await ApiClient.patch(`/api/tasks/${taskId}`, { status: newStatus });
        showToast('Статус задачи обновлен', 'success');
        await loadTasks();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Модальное окно сдачи работы на проверку с отчетом (Исполнитель)
 */
function openSubmitReportModal(taskId, title) {
    const task = allTasks.find(t => t.id === Number(taskId));
    document.getElementById('submit-report-task-id').value = taskId;
    document.getElementById('submit-report-task-title').textContent = title;
    document.getElementById('submit-report-comment').value = task?.reportComment || '';
    document.getElementById('submit-report-file').value = '';

    const existingBox = document.getElementById('existing-report-box');
    const existingFilename = document.getElementById('existing-report-filename');
    if (task && task.reportAttachment && task.reportAttachment.originalName) {
        existingBox.style.display = 'block';
        existingFilename.textContent = fixFilenameEncoding(task.reportAttachment.originalName);
    } else {
        existingBox.style.display = 'none';
    }

    document.getElementById('submit-report-modal').classList.add('active');
}
window.openSubmitReportModal = openSubmitReportModal;

function closeSubmitReportModal() {
    document.getElementById('submit-report-modal').classList.remove('active');
}
window.closeSubmitReportModal = closeSubmitReportModal;

async function handleSubmitReportForm(e) {
    e.preventDefault();
    const taskId = document.getElementById('submit-report-task-id').value;
    const reportComment = document.getElementById('submit-report-comment').value.trim();
    const fileInput = document.getElementById('submit-report-file');
    const hasFile = fileInput.files && fileInput.files.length > 0;

    const task = allTasks.find(t => t.id === Number(taskId));
    const alreadyHasFile = task && task.reportAttachment;

    if (!reportComment && !hasFile && !alreadyHasFile) {
        alert('Пожалуйста, прикрепите файл отчета (архив ZIP, документ) или напишите комментарий о проделанной работе!');
        return;
    }

    const formData = new FormData();
    formData.append('status', 'in_review');
    if (reportComment) formData.append('reportComment', reportComment);
    if (hasFile) formData.append('reportFile', fileInput.files[0]);

    const submitBtn = document.getElementById('btn-confirm-submit-report');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка...';
    }

    try {
        await ApiClient.patch(`/api/tasks/${taskId}`, formData);
        closeSubmitReportModal();
        showToast('Работа успешно сдана на проверку!', 'success');
        await loadTasks();
    } catch (err) {
        alert(err.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '📤 Сдать на проверку';
        }
    }
}
window.handleSubmitReportForm = handleSubmitReportForm;

/**
 * Модальное окно рецензирования (Проверяющий)
 */
function openReviewModal(taskId, title) {
    const task = allTasks.find(t => t.id === Number(taskId));
    document.getElementById('review-task-id').value = taskId;
    document.getElementById('review-task-title').textContent = title;
    document.getElementById('review-comment').value = '';
    toggleReviewCommentRequired();

    const reportBox = document.getElementById('review-executor-report-box');
    const reportText = document.getElementById('review-report-comment-text');
    const reportAttachBox = document.getElementById('review-report-attachment-box');
    const reportDownloadLink = document.getElementById('review-report-download-link');

    if (task && (task.reportComment || task.reportAttachment)) {
        if (reportBox) reportBox.style.display = 'block';
        if (reportText) reportText.textContent = task.reportComment || '(Комментарий к отчету не указан)';

        if (task.reportAttachment && reportAttachBox && reportDownloadLink) {
            reportAttachBox.style.display = 'block';
            reportDownloadLink.href = task.reportAttachment.downloadUrl;
            reportDownloadLink.setAttribute('download', fixFilenameEncoding(task.reportAttachment.originalName));
            reportDownloadLink.innerHTML = `📥 Скачать отчет: <strong>${escapeHtml(fixFilenameEncoding(task.reportAttachment.originalName))}</strong>`;
        } else if (reportAttachBox) {
            reportAttachBox.style.display = 'none';
        }
    } else if (reportBox) {
        reportBox.style.display = 'none';
    }

    document.getElementById('review-modal').classList.add('active');
}
window.openReviewModal = openReviewModal;

function closeReviewModal() {
    document.getElementById('review-modal').classList.remove('active');
}
window.closeReviewModal = closeReviewModal;

function toggleReviewCommentRequired() {
    const decision = document.getElementById('review-decision').value;
    const star = document.getElementById('review-comment-star');
    if (star) star.style.display = (decision === 'rejected') ? 'inline' : 'none';
}

async function handleReviewTask(e) {
    e.preventDefault();
    const taskId = document.getElementById('review-task-id').value;
    const status = document.getElementById('review-decision').value;
    const reviewComment = document.getElementById('review-comment').value.trim();

    if (status === 'rejected' && !reviewComment) {
        alert('Пожалуйста, укажите замечания при возврате на доработку!');
        return;
    }

    try {
        await ApiClient.patch(`/api/tasks/${taskId}`, { status, reviewComment });
        closeReviewModal();
        showToast('Решение по проверке зафиксировано', 'success');
        await loadTasks();
    } catch (err) {
        alert(err.message);
    }
}

/**
 * Модальное окно редактирования задачи (Руководитель)
 */
async function openEditModal(taskId) {
    try {
        const res = await ApiClient.get(`/api/tasks/${taskId}`);
        const task = res.data;

        document.getElementById('edit-task-id').value = task.id;
        document.getElementById('edit-title').value = task.title;
        document.getElementById('edit-desc').value = task.description || '';
        document.getElementById('edit-status').value = task.status;

        if (flatpickrEdit) flatpickrEdit.setDate(task.dueDate || '');

        if (!allUsers || allUsers.length === 0) {
            try {
                const cached = localStorage.getItem('cached_users');
                if (cached) populateUserSelects(JSON.parse(cached));
            } catch {}
        }

        const editExec = document.getElementById('edit-executor');
        if (editExec) {
            editExec.value = task.executor ? String(task.executor.id) : '';
        }

        const editRev = document.getElementById('edit-reviewer');
        if (editRev) {
            editRev.value = task.reviewer ? String(task.reviewer.id) : '';
        }

        const attachBox = document.getElementById('current-attachment-box');
        if (task.attachment) {
            attachBox.style.display = 'block';
            document.getElementById('current-filename').textContent = fixFilenameEncoding(task.attachment.originalName);
            document.getElementById('edit-removeAttachment').checked = false;
        } else {
            attachBox.style.display = 'none';
        }

        document.getElementById('edit-modal').classList.add('active');
    } catch (err) {
        showToast(err.message, 'error');
    }
}
function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

async function handleEditTask(e) {
    e.preventDefault();
    const taskId = document.getElementById('edit-task-id').value;
    const form = e.target;
    const formData = new FormData(form);

    try {
        await ApiClient.put(`/api/tasks/${taskId}`, formData);
        closeEditModal();
        showToast('Изменения задачи сохранены', 'success');
        await loadTasks();
    } catch (err) {
        alert(err.message);
    }
}

/**
 * Модальное окно удаления задачи (Руководитель)
 */
let taskToDeleteId = null;
function openDeleteModal(taskId, title) {
    taskToDeleteId = taskId;
    document.getElementById('delete-task-title').textContent = title;
    document.getElementById('delete-modal').classList.add('active');
}
function closeDeleteModal() {
    taskToDeleteId = null;
    document.getElementById('delete-modal').classList.remove('active');
}

async function handleConfirmDelete() {
    if (!taskToDeleteId) return;
    try {
        await ApiClient.delete(`/api/tasks/${taskToDeleteId}`);
        closeDeleteModal();
        showToast('Задача успешно удалена', 'success');
        await loadTasks();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Всплывающие уведомления (Toasts)
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

function showGlobalAlert(message) {
    const alertEl = document.getElementById('global-alert');
    const textEl = document.getElementById('global-alert-text');
    if (alertEl && textEl) {
        textEl.textContent = message;
        alertEl.style.display = 'flex';
    }
}
function hideGlobalAlert() {
    const alertEl = document.getElementById('global-alert');
    if (alertEl) alertEl.style.display = 'none';
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const cp1252ClientMap = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};

/**
 * Исправление возможных искажений кодировки кириллических имен файлов (mojibake)
 */
function fixFilenameEncoding(name) {
    if (!name || typeof name !== 'string') return name;
    if (/[\u0400-\u04FF]/.test(name)) return name;
    if (!/[ÐÑ]/.test(name)) return name;
    try {
        const bytes = [];
        for (let i = 0; i < name.length; i++) {
            const code = name.charCodeAt(i);
            if (cp1252ClientMap[code]) {
                bytes.push(cp1252ClientMap[code]);
            } else if (code <= 255) {
                bytes.push(code);
            } else {
                return name;
            }
        }
        const decoded = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        if (!decoded.includes('\uFFFD') && decoded !== name) {
            return decoded;
        }
    } catch {
        // fallback
    }
    return name;
}

