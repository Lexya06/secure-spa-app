/**
 * Управление аутентификацией, ролями, сессиями и восстановлением пароля
 */

let currentUser = null;

const DEMO_ACCOUNTS = {
    manager: { email: 'manager@example.com', pass: 'Manager123!' },
    executor: { email: 'executor@example.com', pass: 'Executor123!' },
    reviewer: { email: 'reviewer@example.com', pass: 'Reviewer123!' }
};

/**
 * Инициализация аутентификации при загрузке приложения
 */
async function initAuth() {
    const savedUser = localStorage.getItem('user_info');
    const token = ApiClient.getAccessToken();

    if (savedUser && token) {
        try {
            currentUser = JSON.parse(savedUser);
            updateAuthUI();
            // Проверяем валидность токена на сервере
            const meRes = await ApiClient.get('/api/auth/me');
            currentUser = meRes.data;
            localStorage.setItem('user_info', JSON.stringify(currentUser));
            updateAuthUI();
        } catch {
            currentUser = null;
            ApiClient.clearTokens();
            updateAuthUI();
        }
    } else {
        updateAuthUI();
    }
}

/**
 * Обновление интерфейса в зависимости от роли и состояния входа
 */
function updateAuthUI() {
    const navGuest = document.getElementById('nav-guest');
    const navAuth = document.getElementById('nav-auth');
    const roleBanner = document.getElementById('role-banner');
    const managerCreate = document.getElementById('manager-create-section');
    const btnAudit = document.getElementById('btn-audit-logs');

    if (currentUser) {
        navGuest.style.display = 'none';
        navAuth.style.display = 'flex';

        document.getElementById('nav-user-name').textContent = currentUser.name;
        const roleBadge = document.getElementById('nav-role-badge');
        roleBadge.className = `role-pill role-${currentUser.role}`;

        const roleNames = {
            manager: 'Руководитель',
            executor: 'Исполнитель',
            reviewer: 'Проверяющий'
        };
        roleBadge.textContent = roleNames[currentUser.role] || currentUser.role;

        // Показ баннера роли
        roleBanner.style.display = 'flex';
        roleBanner.className = `role-banner ${currentUser.role}`;

        const bannerTitle = document.getElementById('role-banner-title');
        const bannerDesc = document.getElementById('role-banner-desc');
        const bannerIcon = document.getElementById('role-banner-icon');

        if (currentUser.role === 'manager') {
            bannerIcon.textContent = '👔';
            bannerTitle.textContent = 'Режим: Руководитель (Manager)';
            bannerDesc.textContent = 'Вам доступны: создание задач, распределение исполнителей/проверяющих, редактирование любых полей, удаление задач и просмотр журнала аудита.';
            managerCreate.style.display = 'block';
            btnAudit.style.display = 'inline-block';
        } else if (currentUser.role === 'executor') {
            bannerIcon.textContent = '🔨';
            bannerTitle.textContent = 'Режим: Исполнитель (Executor)';
            bannerDesc.textContent = 'Вам доступны: взятие задач в работу (Ожидает ➔ В работе) и передача на проверку (В работе ➔ На проверке). Самостоятельное закрытие и удаление задач запрещено.';
            managerCreate.style.display = 'none';
            btnAudit.style.display = 'none';
        } else if (currentUser.role === 'reviewer') {
            bannerIcon.textContent = '🔍';
            bannerTitle.textContent = 'Режим: Проверяющий (Reviewer)';
            bannerDesc.textContent = 'Вам доступны: проверка задач в статусе «На проверке», утверждение (➔ Завершено) или возврат на доработку с замечаниями (➔ Доработка).';
            managerCreate.style.display = 'none';
            btnAudit.style.display = 'none';
        }
    } else {
        navGuest.style.display = 'flex';
        navAuth.style.display = 'none';
        roleBanner.style.display = 'none';
        managerCreate.style.display = 'none';
        btnAudit.style.display = 'none';
    }
}

/**
 * Быстрый вход для демонстрации лабораторной работы
 */
async function quickLogin(role) {
    const creds = DEMO_ACCOUNTS[role];
    if (!creds) return;

    try {
        showToast(`Выполняется вход под ролью "${role}"...`, 'info');
        const res = await ApiClient.post('/api/auth/login', {
            email: creds.email,
            password: creds.pass
        });

        ApiClient.setTokens(res.data.accessToken, res.data.refreshToken);
        currentUser = res.data.user;
        localStorage.setItem('user_info', JSON.stringify(currentUser));

        updateAuthUI();
        showToast(`Успешный вход: ${currentUser.name} (${currentUser.role})`, 'success');

        if (window.loadTasks) window.loadTasks();
        if (window.loadUsers) window.loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Обычный вход по форме
 */
async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    const errorBox = document.getElementById('login-errors');
    errorBox.style.display = 'none';

    try {
        const res = await ApiClient.post('/api/auth/login', { email, password });
        ApiClient.setTokens(res.data.accessToken, res.data.refreshToken);
        currentUser = res.data.user;
        localStorage.setItem('user_info', JSON.stringify(currentUser));

        closeLoginModal();
        form.reset();
        updateAuthUI();
        showToast('Вход успешно выполнен', 'success');

        if (window.loadTasks) window.loadTasks();
        if (window.loadUsers) window.loadUsers();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    }
}

/**
 * Регистрация нового пользователя
 */
async function handleRegisterSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const role = form.role.value;
    const password = form.password.value;
    const errorBox = document.getElementById('register-errors');
    errorBox.style.display = 'none';

    try {
        const res = await ApiClient.post('/api/auth/register', { name, email, role, password });
        ApiClient.setTokens(res.data.accessToken, res.data.refreshToken);
        currentUser = res.data.user;
        localStorage.setItem('user_info', JSON.stringify(currentUser));

        closeRegisterModal();
        form.reset();
        updateAuthUI();
        showToast('Регистрация успешна! Добро пожаловать.', 'success');

        if (window.loadTasks) window.loadTasks();
        if (window.loadUsers) window.loadUsers();
    } catch (err) {
        let msg = err.message;
        if (err.errors && err.errors.length) {
            msg = err.errors.map(e => e.message).join('; ');
        }
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
    }
}

/**
 * Выход из системы (отзыв токена и сессии)
 */
async function handleLogout() {
    try {
        await ApiClient.post('/api/auth/logout', {});
    } catch (e) {
        console.warn('Logout error', e);
    } finally {
        ApiClient.clearTokens();
        currentUser = null;
        updateAuthUI();
        showToast('Вы вышли из системы', 'info');
        if (window.loadTasks) window.loadTasks();
    }
}

/**
 * Запрос сброса пароля через email
 */
async function handleForgotSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const email = form.email.value.trim();
    const errorBox = document.getElementById('forgot-errors');
    const successBox = document.getElementById('forgot-success');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    try {
        const res = await ApiClient.post('/api/auth/forgot-password', { email });
        let html = `<strong>${res.message}</strong>`;
        if (res.debugToken) {
            html += `<br><br><span style="font-size: 11px; color: #475569;">[Тест/демо] Одноразовый токен: <code>${res.debugToken}</code></span>`;
            if (res.previewUrl) {
                html += `<br><a href="${res.previewUrl}" target="_blank" style="color: #2563eb; font-size: 12px;">Посмотреть сгенерированное письмо Ethereal</a>`;
            }
            html += `<br><br><button type="button" class="btn btn-sm btn-primary" onclick="openResetModalWithToken('${res.debugToken}')">Ввести новый пароль</button>`;
        }
        successBox.innerHTML = html;
        successBox.style.display = 'block';
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    }
}

/**
 * Сброс пароля по коду
 */
async function handleResetPasswordSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const token = form.token.value.trim();
    const newPassword = form.newPassword.value;
    const errorBox = document.getElementById('reset-errors');
    errorBox.style.display = 'none';

    try {
        const res = await ApiClient.post('/api/auth/reset-password', { token, newPassword });
        closeResetModal();
        form.reset();
        showToast(res.message, 'success');
        openLoginModal();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    }
}

/**
 * Загрузка активных сессий
 */
async function loadSessions() {
    const listEl = document.getElementById('sessions-list');
    listEl.innerHTML = '<p>Загрузка сессий...</p>';

    try {
        const res = await ApiClient.get('/api/auth/sessions');
        if (!res.data || res.data.length === 0) {
            listEl.innerHTML = '<p>Активных сессий нет</p>';
            return;
        }

        listEl.innerHTML = res.data.map(s => `
            <div class="session-card ${s.isCurrent ? 'current' : ''}">
                <div class="session-info">
                    <strong>${s.deviceName} ${s.isCurrent ? '<span class="current-device-tag">Текущее устройство</span>' : ''}</strong>
                    <div class="session-meta">
                        IP: ${s.ipAddress || 'Неизвестен'} | Активность: ${new Date(s.lastActiveAt).toLocaleString('ru-RU')}
                    </div>
                </div>
                ${!s.isCurrent ? `
                    <button class="btn btn-sm btn-danger" onclick="revokeSingleSession('${s.id}')">
                        Завершить
                    </button>
                ` : ''}
            </div>
        `).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="modal-warning-text">${err.message}</p>`;
    }
}

async function revokeSingleSession(sessionId) {
    if (!confirm('Завершить эту сессию на удаленном устройстве?')) return;
    try {
        await ApiClient.delete(`/api/auth/sessions/${sessionId}`);
        showToast('Сессия отозвана', 'success');
        loadSessions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function revokeOtherSessions() {
    if (!confirm('Отозвать сессии на всех остальных устройствах?')) return;
    try {
        const res = await ApiClient.post('/api/auth/sessions/revoke-others', {});
        showToast(res.message, 'success');
        loadSessions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Загрузка журнала аудита безопасности (для Руководителя)
 */
async function loadAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Загрузка логов...</td></tr>';

    try {
        const res = await ApiClient.get('/api/logs/audit?limit=50');
        if (!res.data || res.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Журнал аудита пуст</td></tr>';
            return;
        }

        tbody.innerHTML = res.data.map(log => {
            const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('ru-RU') : '-';
            const action = log.action || log.message || '-';
            const user = log.user ? `${log.user.name || log.user.email || '#' + log.user.id}` : '-';
            const ip = log.ip || '-';
            const status = log.status || 'INFO';
            const details = log.details ? JSON.stringify(log.details) : '';

            return `
                <tr>
                    <td>${time}</td>
                    <td><code>${action}</code></td>
                    <td>${user}</td>
                    <td>${ip}</td>
                    <td><strong>${status}</strong></td>
                    <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${details}">${details}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color: red; text-align: center;">${err.message}</td></tr>`;
    }
}

// Модальные окна helper functions
function openLoginModal() { document.getElementById('login-modal').classList.add('active'); }
function closeLoginModal() { document.getElementById('login-modal').classList.remove('active'); }

function openRegisterModal() { document.getElementById('register-modal').classList.add('active'); }
function closeRegisterModal() { document.getElementById('register-modal').classList.remove('active'); }

function openForgotModal() { document.getElementById('forgot-modal').classList.add('active'); }
function closeForgotModal() { document.getElementById('forgot-modal').classList.remove('active'); }

function openForgotPasswordModal() {
    closeLoginModal();
    openForgotModal();
}

function openResetModalWithToken(token) {
    closeForgotModal();
    document.getElementById('reset-token').value = token;
    document.getElementById('reset-password-modal').classList.add('active');
}
function closeResetModal() { document.getElementById('reset-password-modal').classList.remove('active'); }

function openSessionsModal() {
    document.getElementById('sessions-modal').classList.add('active');
    loadSessions();
}
function closeSessionsModal() { document.getElementById('sessions-modal').classList.remove('active'); }

function openAuditModal() {
    document.getElementById('audit-modal').classList.add('active');
    loadAuditLogs();
}
function closeAuditModal() { document.getElementById('audit-modal').classList.remove('active'); }

// Слушатель события истечения сессии
window.addEventListener('auth:expired', () => {
    currentUser = null;
    updateAuthUI();
    showToast('Срок действия сессии истек. Пожалуйста, выполните вход заново.', 'error');
    openLoginModal();
});
