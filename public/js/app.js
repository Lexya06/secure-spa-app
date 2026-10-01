/**
 * Главный SPA контроллер приложения (Лабораторная работа №3)
 */

let allTasks = [];
let allUsers = [];
let currentFilter = 'all';
let searchQuery = '';
let myTasksOnly = false;
let flatpickrCreate = null;
let flatpickrEdit = null;

// Инициализация при загрузке документа
document.addEventListener('DOMContentLoaded', async () => {
    initDatepickers();
    setupEventListeners();
    await initAuth();

    // Если нет сохраненного пользователя, автоматически логиним как Руководитель для быстрого старта
    if (!currentUser) {
        await quickLogin('manager');
    } else {
        await loadUsers();
        await loadTasks();
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
            flatpickrCreate.clear();
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

    // Формы задач
    document.getElementById('create-task-form')?.addEventListener('submit', handleCreateTask);
    document.getElementById('edit-task-form')?.addEventListener('submit', handleEditTask);
    document.getElementById('review-task-form')?.addEventListener('submit', handleReviewTask);

    document.getElementById('btn-confirm-delete')?.addEventListener('click', handleConfirmDelete);
    document.getElementById('btn-reset-form')?.addEventListener('click', resetCreateForm);

    // Фильтры
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            currentFilter = target.getAttribute('data-filter');
            loadTasks();
        });
    });

    // Поиск
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');

    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        searchQuery = e.target.value;
        btnClearSearch.style.display = searchQuery ? 'block' : 'none';
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

    // Чекбокс "Только мои задачи"
    document.getElementById('my-tasks-only')?.addEventListener('change', (e) => {
        myTasksOnly = e.target.checked;
        loadTasks();
    });
}

/**
 * Загрузка пользователей для списков назначения исполнителей/проверяющих
 */
async function loadUsers() {
    if (!currentUser) return;
    try {
        const res = await ApiClient.get('/api/auth/users');
        allUsers = res.data || [];

        const execSelect = document.getElementById('task-executor');
        const revSelect = document.getElementById('task-reviewer');
        const editExecSelect = document.getElementById('edit-executor');
        const editRevSelect = document.getElementById('edit-reviewer');

        const execOptions = allUsers
            .filter(u => u.role === 'executor' || u.role === 'manager')
            .map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`)
            .join('');

        const revOptions = allUsers
            .filter(u => u.role === 'reviewer' || u.role === 'manager')
            .map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`)
            .join('');

        if (execSelect) execSelect.innerHTML = '<option value="">-- Не назначен --</option>' + execOptions;
        if (revSelect) revSelect.innerHTML = '<option value="">-- Не назначен --</option>' + revOptions;
        if (editExecSelect) editExecSelect.innerHTML = '<option value="">-- Не назначен --</option>' + execOptions;
        if (editRevSelect) editRevSelect.innerHTML = '<option value="">-- Не назначен --</option>' + revOptions;
    } catch (e) {
        console.warn('Ошибка загрузки пользователей:', e);
    }
}
window.loadUsers = loadUsers;

/**
 * Загрузка задач с сервера
 */
async function loadTasks() {
    if (!currentUser) {
        renderTasks([]);
        return;
    }

    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'block';

    try {
        const params = {};
        if (currentFilter !== 'all') params.status = currentFilter;
        if (searchQuery) params.search = searchQuery;
        if (myTasksOnly) params.roleFilter = 'my';

        const res = await ApiClient.get('/api/tasks', params);
        allTasks = res.data || [];
        renderTasks(allTasks);
        updateCounters();
    } catch (err) {
        showGlobalAlert(err.message);
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}
window.loadTasks = loadTasks;

/**
 * Подсчет количества задач по статусам
 */
function updateCounters() {
    const counts = {
        all: allTasks.length,
        pending: 0,
        in_progress: 0,
        in_review: 0,
        completed: 0,
        rejected: 0
    };

    allTasks.forEach(t => {
        if (counts[t.status] !== undefined) counts[t.status]++;
    });

    Object.keys(counts).forEach(k => {
        const el = document.getElementById(`count-${k}`);
        if (el) el.textContent = counts[k];
    });
}

/**
 * Отрисовка списка задач с элементами управления в соответствии с ролью
 */
function renderTasks(tasks) {
    const listEl = document.getElementById('task-list');
    const emptyState = document.getElementById('empty-state');

    if (!listEl) return;

    if (!tasks || tasks.length === 0) {
        listEl.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const statusLabels = {
        pending: 'Ожидает',
        in_progress: 'В работе',
        in_review: 'На проверке',
        completed: 'Завершено',
        rejected: 'На доработке'
    };

    const role = currentUser ? currentUser.role : null;

    listEl.innerHTML = tasks.map(t => {
        const creatorName = t.creator ? t.creator.name : 'Неизвестен';
        const execName = t.executor ? t.executor.name : 'Не назначен';
        const revName = t.reviewer ? t.reviewer.name : 'Не назначен';
        const dueDate = t.dueDate ? new Date(t.dueDate).toLocaleDateString('ru-RU') : 'Бессрочно';

        // Формирование кнопок действий в зависимости от роли (RBAC на клиенте)
        let actionsHtml = '';

        if (role === 'manager') {
            // Руководитель имеет полный доступ
            actionsHtml = `
                <button class="btn btn-sm btn-secondary" onclick="openEditModal(${t.id})">✏️ Редактировать</button>
                <button class="btn btn-sm btn-danger" onclick="openDeleteModal(${t.id}, '${escapeHtml(t.title)}')">🗑️ Удалить</button>
            `;
        } else if (role === 'executor') {
            // Исполнитель
            if (t.status === 'pending') {
                actionsHtml += `<button class="btn btn-sm btn-primary" onclick="patchTaskStatus(${t.id}, 'in_progress')">▶️ Взять в работу</button>`;
            } else if (t.status === 'in_progress') {
                actionsHtml += `<button class="btn btn-sm btn-warning" onclick="patchTaskStatus(${t.id}, 'in_review')">📤 Сдать на проверку</button>`;
            } else if (t.status === 'rejected') {
                actionsHtml += `<button class="btn btn-sm btn-primary" onclick="patchTaskStatus(${t.id}, 'in_progress')">🛠️ Взять на исправление</button>`;
            }
        } else if (role === 'reviewer') {
            // Проверяющий
            if (t.status === 'in_review') {
                actionsHtml += `<button class="btn btn-sm btn-primary" onclick="openReviewModal(${t.id}, '${escapeHtml(t.title)}')">🔍 Проверить работу</button>`;
            }
        }

        return `
            <li class="task-item status-${t.status}" id="task-${t.id}">
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
                    <span class="meta-item">🔨 Исполнитель: <strong>${escapeHtml(execName)}</strong></span>
                    <span class="meta-item">🔍 Проверяющий: <strong>${escapeHtml(revName)}</strong></span>
                </div>

                ${t.reviewComment ? `
                    <div class="task-comment-box">
                        <strong>Замечания проверяющего:</strong> ${escapeHtml(t.reviewComment)}
                    </div>
                ` : ''}

                <div class="task-item-footer">
                    <div>
                        ${t.attachment ? `
                            <a href="${t.attachment.downloadUrl}" class="task-attachment-link" target="_blank" download>
                                📎 ${escapeHtml(t.attachment.originalName || 'Вложение')}
                            </a>
                        ` : ''}
                    </div>
                    <div class="task-actions">
                        ${actionsHtml}
                    </div>
                </div>
            </li>
        `;
    }).join('');
}

/**
 * Создание задачи (Руководитель)
 */
async function handleCreateTask(e) {
    e.preventDefault();
    const form = e.target;
    const errorBox = document.getElementById('form-validation-errors');
    errorBox.style.display = 'none';

    const formData = new FormData(form);

    try {
        await ApiClient.post('/api/tasks', formData);
        showToast('Задача успешно создана!', 'success');
        resetCreateForm();
        loadTasks();
    } catch (err) {
        let msg = err.message;
        if (err.errors && err.errors.length) {
            msg = err.errors.map(e => e.message).join('; ');
        }
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
    }
}

function resetCreateForm() {
    const form = document.getElementById('create-task-form');
    if (form) form.reset();
    if (flatpickrCreate) flatpickrCreate.clear();
    const errBox = document.getElementById('form-validation-errors');
    if (errBox) errBox.style.display = 'none';
}

/**
 * Быстрое изменение статуса (PATCH)
 */
async function patchTaskStatus(taskId, newStatus) {
    try {
        await ApiClient.patch(`/api/tasks/${taskId}`, { status: newStatus });
        showToast(`Статус задачи #${taskId} успешно обновлен`, 'success');
        loadTasks();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Модальное окно проверки / рецензирования (Проверяющий)
 */
function openReviewModal(taskId, title) {
    document.getElementById('review-task-id').value = taskId;
    document.getElementById('review-task-title').textContent = title;
    document.getElementById('review-comment').value = '';
    toggleReviewCommentRequired();
    document.getElementById('review-modal').classList.add('active');
}
function closeReviewModal() {
    document.getElementById('review-modal').classList.remove('active');
}

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
        showToast('Решение по проверке задачи зафиксировано', 'success');
        loadTasks();
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

        if (task.executor) document.getElementById('edit-executor').value = task.executor.id;
        if (task.reviewer) document.getElementById('edit-reviewer').value = task.reviewer.id;

        const attachBox = document.getElementById('current-attachment-box');
        if (task.attachment) {
            attachBox.style.display = 'block';
            document.getElementById('current-filename').textContent = task.attachment.originalName;
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
        loadTasks();
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
        loadTasks();
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
    }, 4000);
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
