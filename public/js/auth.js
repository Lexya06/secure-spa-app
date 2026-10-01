/**
 * Модуль управления аутентификацией, ролями и активными сессиями
 */

let currentUser = null;

// Предустановленные демо-пользователи для удобства демонстрации ролей на защите
const DEMO_ACCOUNTS = {
    manager: { email: 'manager@example.com', pass: 'Manager123!' },
    executor: { email: 'executor@example.com', pass: 'Executor123!' },
    reviewer: { email: 'reviewer@example.com', pass: 'Reviewer123!' }
};

function getRoleName(role) {
    const roleNames = {
        manager: 'Руководитель',
        executor: 'Исполнитель',
        reviewer: 'Проверяющий'
    };
    return roleNames[role] || role;
}

/**
 * Инициализация аутентификации при загрузке приложения
 */
async function initAuth() {
    const savedUser = localStorage.getItem('user_info');
    const token = ApiClient.getAccessToken();

    initDemoPanelState();
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
 * Обновление интерфейса в зависимости от текущей роли
 */
function updateAuthUI() {
    const navGuest = document.getElementById('nav-guest');
    const navAuth = document.getElementById('nav-auth');
    const roleBanner = document.getElementById('role-banner');
    const managerCreate = document.getElementById('manager-create-section');

    if (currentUser) {
        navGuest.style.display = 'none';
        navAuth.style.display = 'flex';

        document.getElementById('nav-user-name').textContent = currentUser.name;
        const roleBadge = document.getElementById('nav-role-badge');
        roleBadge.className = `role-pill role-${currentUser.role}`;
        roleBadge.textContent = getRoleName(currentUser.role);

        // Информационный баннер текущей роли
        roleBanner.style.display = 'flex';
        roleBanner.className = `role-banner ${currentUser.role}`;

        const bannerTitle = document.getElementById('role-banner-title');
        const bannerDesc = document.getElementById('role-banner-desc');
        const bannerIcon = document.getElementById('role-banner-icon');

        if (currentUser.role === 'manager') {
            bannerIcon.textContent = '👔';
            bannerTitle.textContent = `Вы вошли как Руководитель (${currentUser.name})`;
            bannerDesc.textContent = 'Вам доступны: создание задач, назначение исполнителей и проверяющих, редактирование любых полей и удаление задач.';
            managerCreate.style.display = 'block';
        } else if (currentUser.role === 'executor') {
            bannerIcon.textContent = '🔨';
            bannerTitle.textContent = `Вы вошли как Исполнитель (${currentUser.name})`;
            bannerDesc.textContent = 'Вам доступны: взятие назначенных задач в работу (Ожидает ➔ В работе) и отправка на проверку (В работе ➔ На проверке). Удаление и самостоятельное закрытие задач запрещено.';
            managerCreate.style.display = 'none';
        } else if (currentUser.role === 'reviewer') {
            bannerIcon.textContent = '🔍';
            bannerTitle.textContent = `Вы вошли как Проверяющий (${currentUser.name})`;
            bannerDesc.textContent = 'Вам доступны: проверка задач в статусе «На проверке», утверждение (➔ Завершено) или возврат на доработку (➔ На доработке) с обязательным комментарием замечаний.';
            managerCreate.style.display = 'none';
        }
    } else {
        navGuest.style.display = 'flex';
        navAuth.style.display = 'none';
        roleBanner.style.display = 'none';
        managerCreate.style.display = 'none';
    }
}

/**
 * Быстрый вход под одной из 3 ролей (без создания лишних сессий)
 */
async function quickLogin(role) {
    const creds = DEMO_ACCOUNTS[role];
    if (!creds) return;

    try {
        // Если уже выполнен вход другим аккаунтом, завершаем старую сессию
        if (currentUser && currentUser.email !== creds.email) {
            try {
                await ApiClient.post('/api/auth/logout', {});
            } catch {
                // Игнорируем ошибку логаута
            }
        }
        ApiClient.clearTokens();
        currentUser = null;

        showToast(`Выполняется вход под ролью "${getRoleName(role)}"...`, 'info');
        const res = await ApiClient.post('/api/auth/login', {
            email: creds.email,
            password: creds.pass
        });

        ApiClient.setTokens(res.data.accessToken, res.data.refreshToken);
        currentUser = res.data.user;
        localStorage.setItem('user_info', JSON.stringify(currentUser));

        updateAuthUI();
        showToast(`Вы вошли как ${currentUser.name} (${getRoleName(currentUser.role)})`, 'success');

        if (window.loadUsers) await window.loadUsers();
        if (window.loadTasks) await window.loadTasks();
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
        if (currentUser) {
            try { await ApiClient.post('/api/auth/logout', {}); } catch {}
        }
        ApiClient.clearTokens();

        const res = await ApiClient.post('/api/auth/login', { email, password });
        ApiClient.setTokens(res.data.accessToken, res.data.refreshToken);
        currentUser = res.data.user;
        localStorage.setItem('user_info', JSON.stringify(currentUser));

        closeLoginModal();
        form.reset();
        updateAuthUI();
        showToast(`Вход выполнен: ${currentUser.name}`, 'success');

        if (window.loadUsers) await window.loadUsers();
        if (window.loadTasks) await window.loadTasks();
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

        if (window.loadUsers) await window.loadUsers();
        if (window.loadTasks) await window.loadTasks();
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
 * Выход из системы
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
            html += `<br><br><span style="font-size: 12px; color: #475569;">🔑 Одноразовый код сброса: <code>${res.debugToken}</code></span>`;
            if (res.previewUrl) {
                html += `<br><a href="${res.previewUrl}" target="_blank" style="color: #2563eb; font-size: 12px; display: inline-block; margin-top: 4px;">Просмотреть отправленное письмо (Ethereal)</a>`;
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
 * Загрузка активных сессий (устройств) текущего пользователя
 */
async function loadSessions() {
    const listEl = document.getElementById('sessions-list');
    listEl.innerHTML = '<p>Загрузка списка сессий...</p>';

    try {
        const res = await ApiClient.get('/api/auth/sessions');
        if (!res.data || res.data.length === 0) {
            listEl.innerHTML = '<p>Активных сессий не найдено.</p>';
            return;
        }

        listEl.innerHTML = res.data.map(s => {
            const lastActive = s.lastActiveAt 
                ? new Date(s.lastActiveAt).toLocaleString('ru-RU')
                : 'Только что';

            return `
                <div class="session-card ${s.isCurrent ? 'current' : ''}">
                    <div class="session-info">
                        <strong>${s.deviceName} ${s.isCurrent ? '<span class="current-device-tag">Текущее устройство</span>' : ''}</strong>
                        <div class="session-meta">
                            IP: <code>${s.ipAddress || '127.0.0.1'}</code> &bull; Последняя активность: ${lastActive}
                        </div>
                    </div>
                    ${!s.isCurrent ? `
                        <button class="btn btn-sm btn-danger" onclick="revokeSingleSession('${s.id}')">
                            Завершить
                        </button>
                    ` : '<span style="font-size: 11px; color: #16a34a; font-weight: 600;">Активна</span>'}
                </div>
            `;
        }).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="modal-warning-text">${err.message}</p>`;
    }
}

async function revokeSingleSession(sessionId) {
    if (!confirm('Завершить эту сессию на выбранном устройстве?')) return;
    try {
        await ApiClient.delete(`/api/auth/sessions/${sessionId}`);
        showToast('Сессия успешно отозвана', 'success');
        loadSessions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function revokeOtherSessions() {
    if (!confirm('Завершить сессии на всех остальных устройствах?')) return;
    try {
        const res = await ApiClient.post('/api/auth/sessions/revoke-others', {});
        showToast(res.message, 'success');
        loadSessions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Функции управления модальными окнами
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

// Управление видимостью демонстрационной панели
async function toggleDemoPanel(show) {
    const panel = document.getElementById('demo-switchers');
    const restoreBtn = document.getElementById('btn-show-demo');
    if (show) {
        localStorage.removeItem('hide_demo_panel');
        if (panel) panel.style.display = 'flex';
        if (restoreBtn) restoreBtn.style.display = 'none';
        showToast('Демонстрационная панель ролей включена', 'info');
    } else {
        localStorage.setItem('hide_demo_panel', 'true');
        if (panel) panel.style.display = 'none';
        if (restoreBtn) restoreBtn.style.display = 'inline-block';

        // Автоматически завершаем сессию при отключении демо-режима
        if (currentUser) {
            await handleLogout();
        }

        showToast('Демо-панель скрыта. Теперь выполняется вход вручную.', 'info');
        openLoginModal();
    }
}

function initDemoPanelState() {
    const isHidden = localStorage.getItem('hide_demo_panel') === 'true';
    const panel = document.getElementById('demo-switchers');
    const restoreBtn = document.getElementById('btn-show-demo');
    if (isHidden) {
        if (panel) panel.style.display = 'none';
        if (restoreBtn) restoreBtn.style.display = 'inline-block';
    } else {
        if (panel) panel.style.display = 'flex';
        if (restoreBtn) restoreBtn.style.display = 'none';
    }
}

// Слушатель события истечения сессии
window.addEventListener('auth:expired', () => {
    currentUser = null;
    updateAuthUI();
    showToast('Срок действия сессии истек. Войдите заново.', 'error');
    openLoginModal();
});
