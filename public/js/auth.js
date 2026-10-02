/**
 * Модуль управления аутентификацией, ролями и активными сессиями
 */

let currentUser = null;

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

    if (savedUser && token) {
        try {
            currentUser = JSON.parse(savedUser);
            // Проверяем валидность токена на сервере
            const meRes = await ApiClient.get('/api/auth/me');
            const freshUser = meRes.data;
            if (JSON.stringify(currentUser) !== JSON.stringify(freshUser)) {
                currentUser = freshUser;
                localStorage.setItem('user_info', JSON.stringify(currentUser));
                updateAuthUI();
                if (window.loadTasks) window.loadTasks(false);
            }
        } catch {
            currentUser = null;
            ApiClient.clearTokens();
            updateAuthUI();
            if (window.resetAppState) window.resetAppState();
        }
    } else {
        updateAuthUI();
    }

    checkUrlForResetToken();
}

/**
 * Обновление интерфейса в зависимости от текущей роли
 */
function updateAuthUI() {
    const navGuest = document.getElementById('nav-guest');
    const navAuth = document.getElementById('nav-auth');
    const roleBanner = document.getElementById('role-banner');
    const managerCreate = document.getElementById('manager-create-section');
    const controlsPanel = document.getElementById('controls-panel');
    const tasksHeader = document.getElementById('tasks-header');

    if (currentUser) {
        document.documentElement.classList.add('is-auth');
        document.documentElement.classList.remove('role-manager', 'role-executor', 'role-reviewer');
        document.documentElement.classList.add('role-' + currentUser.role);

        if (navGuest) navGuest.style.display = 'none';
        if (navAuth) navAuth.style.display = 'flex';

        const navName = document.getElementById('nav-user-name');
        if (navName) navName.textContent = currentUser.name;

        const roleBadge = document.getElementById('nav-role-badge');
        if (roleBadge) {
            roleBadge.className = `role-pill role-${currentUser.role}`;
            roleBadge.textContent = getRoleName(currentUser.role);
        }

        // Информационный баннер текущей роли
        if (roleBanner) {
            roleBanner.style.display = 'flex';
            roleBanner.className = `role-banner ${currentUser.role}`;
        }

        const bannerTitle = document.getElementById('role-banner-title');
        const bannerDesc = document.getElementById('role-banner-desc');
        const bannerIcon = document.getElementById('role-banner-icon');

        if (currentUser.role === 'manager') {
            if (bannerIcon) bannerIcon.textContent = '👔';
            if (bannerTitle) bannerTitle.textContent = `Вы вошли как Руководитель (${currentUser.name})`;
            if (bannerDesc) bannerDesc.textContent = 'Вам доступны: создание задач, назначение исполнителей и проверяющих, редактирование любых полей и удаление задач.';
            if (managerCreate) managerCreate.style.display = 'block';
        } else if (currentUser.role === 'executor') {
            if (bannerIcon) bannerIcon.textContent = '🔨';
            if (bannerTitle) bannerTitle.textContent = `Вы вошли как Исполнитель (${currentUser.name})`;
            if (bannerDesc) bannerDesc.textContent = 'Вам доступны: взятие назначенных задач в работу (Ожидает ➔ В работе) и отправка на проверку (В работе ➔ На проверке). Удаление и самостоятельное закрытие задач запрещено.';
            if (managerCreate) managerCreate.style.display = 'none';
        } else if (currentUser.role === 'reviewer') {
            if (bannerIcon) bannerIcon.textContent = '🔍';
            if (bannerTitle) bannerTitle.textContent = `Вы вошли как Проверяющий (${currentUser.name})`;
            if (bannerDesc) bannerDesc.textContent = 'Вам доступны: проверка задач в статусе «На проверке», утверждение (➔ Завершено) или возврат на доработку (➔ На доработке) с обязательным комментарием замечаний.';
            if (managerCreate) managerCreate.style.display = 'none';
        }

        if (controlsPanel) controlsPanel.style.display = 'flex';
        if (tasksHeader) tasksHeader.style.display = 'flex';
    } else {
        document.documentElement.classList.remove('is-auth', 'role-manager', 'role-executor', 'role-reviewer');
        if (navGuest) navGuest.style.display = 'flex';
        if (navAuth) navAuth.style.display = 'none';
        if (roleBanner) roleBanner.style.display = 'none';
        if (managerCreate) managerCreate.style.display = 'none';
        if (controlsPanel) controlsPanel.style.display = 'none';
        if (tasksHeader) tasksHeader.style.display = 'none';
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
        try {
            localStorage.removeItem('cached_tasks');
            localStorage.removeItem('cached_users');
        } catch {}
        document.documentElement.classList.remove('is-auth', 'role-manager', 'role-executor', 'role-reviewer');
        if (window.resetAppState) {
            window.resetAppState();
        } else if (window.resetCounters) {
            window.resetCounters();
        }
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
    const fields = document.getElementById('forgot-form-fields');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const btn = document.getElementById('btn-forgot-submit');
    const originalBtnText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Отправка письма...';
    }

    try {
        await ApiClient.post('/api/auth/forgot-password', { email });

        // Скрываем поля ввода, чтобы не требовать повторный ввод email
        if (fields) fields.style.display = 'none';

        const html = `
            <div style="margin-bottom: 16px; padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; color: #065f46; font-size: 14px; line-height: 1.6;">
                📬 <strong>Письмо отправлено на вашу реальную почту!</strong><br><br>
                Проверочный код и ссылка для смены пароля отправлены на адрес <strong>${escapeHtml(email)}</strong> через почтовый сервис <strong>Resend</strong>.<br><br>
                Пожалуйста, проверьте ваш почтовый ящик (включая папку «Спам»), скопируйте 6-значный проверочный код и нажмите кнопку ниже.
            </div>

            <button type="button" class="btn btn-primary" style="width: 100%; margin-bottom: 10px;" onclick="openResetModalManual()">
                🔑 Ввести проверочный код из письма и задать новый пароль
            </button>

            <div style="text-align: center; margin-top: 10px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="resetForgotFormState()">
                    ← Ввести другой email
                </button>
            </div>
        `;

        successBox.innerHTML = html;
        successBox.style.display = 'block';
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalBtnText;
        }
    }
}

function resetForgotFormState() {
    const errorBox = document.getElementById('forgot-errors');
    const successBox = document.getElementById('forgot-success');
    const fields = document.getElementById('forgot-form-fields');
    if (errorBox) errorBox.style.display = 'none';
    if (successBox) successBox.style.display = 'none';
    if (fields) fields.style.display = 'block';
    const emailInput = document.getElementById('forgot-email');
    if (emailInput) {
        setTimeout(() => emailInput.focus(), 50);
    }
}

function openLoginModalFromForgot() {
    closeForgotModal();
    openLoginModal();
}

function openForgotPasswordModal() {
    // Автоматически подставляем email, если пользователь уже вводил его в форме входа (чтобы не вводить 2 раза!)
    const loginEmail = document.getElementById('login-email')?.value?.trim();
    const forgotEmail = document.getElementById('forgot-email');
    if (loginEmail && forgotEmail) {
        forgotEmail.value = loginEmail;
    }
    resetForgotFormState();
    closeLoginModal();
    openForgotModal();
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
        showToast(res.message || 'Пароль успешно изменен! Войдите с новым паролем.', 'success');

        // Подставляем email в форму входа, чтобы пользователю осталось ввести только пароль
        const forgotEmail = document.getElementById('forgot-email')?.value?.trim();
        if (forgotEmail) {
            const loginEmail = document.getElementById('login-email');
            if (loginEmail) loginEmail.value = forgotEmail;
        }

        openLoginModal();
        const loginPass = document.getElementById('login-password');
        if (loginPass) {
            loginPass.value = '';
            setTimeout(() => loginPass.focus(), 100);
        }
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    }
}

/**
 * Проверка URL на наличие токена восстановления пароля
 */
function checkUrlForResetToken() {
    let token = null;
    const hash = window.location.hash;
    if (hash && hash.includes('reset-password')) {
        const match = hash.match(/[?&]token=([a-zA-Z0-9]+)/);
        if (match) token = match[1];
    }
    if (!token) {
        const params = new URLSearchParams(window.location.search);
        token = params.get('token');
    }

    if (token) {
        openResetModalWithToken(token);
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }
}
window.addEventListener('hashchange', checkUrlForResetToken);

/**
 * Быстрое заполнение формы входа для 3 ролей (удобство защиты лабораторной)
 */
function fillLoginForm(email, password) {
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = email;
    if (passInput) passInput.value = password;
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

function openResetModalWithToken(token) {
    closeForgotModal();
    const tokenInput = document.getElementById('reset-token');
    if (tokenInput) tokenInput.value = token;
    const errorBox = document.getElementById('reset-errors');
    if (errorBox) errorBox.style.display = 'none';
    const form = document.getElementById('reset-password-form');
    if (form && form.newPassword) form.newPassword.value = '';

    document.getElementById('reset-password-modal').classList.add('active');
    setTimeout(() => {
        const passInput = document.getElementById('reset-new-password');
        if (passInput) passInput.focus();
    }, 100);
}
function closeResetModal() { document.getElementById('reset-password-modal').classList.remove('active'); }

function openResetModalManual() {
    closeForgotModal();
    const tokenInput = document.getElementById('reset-token');
    if (tokenInput) tokenInput.value = '';
    const errorBox = document.getElementById('reset-errors');
    if (errorBox) errorBox.style.display = 'none';
    const form = document.getElementById('reset-password-form');
    if (form) form.reset();
    document.getElementById('reset-password-modal').classList.add('active');
    setTimeout(() => {
        const tokenIn = document.getElementById('reset-token');
        if (tokenIn) tokenIn.focus();
    }, 100);
}

function openChangePasswordModal() {
    const errorBox = document.getElementById('change-password-errors');
    if (errorBox) errorBox.style.display = 'none';
    const form = document.getElementById('change-password-form');
    if (form) form.reset();
    document.getElementById('change-password-modal').classList.add('active');
    setTimeout(() => {
        document.getElementById('change-curr-password')?.focus();
    }, 100);
}

function closeChangePasswordModal() {
    document.getElementById('change-password-modal').classList.remove('active');
}

async function handleChangePasswordSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    const confirmPassword = form.confirmPassword.value;
    const errorBox = document.getElementById('change-password-errors');
    if (errorBox) errorBox.style.display = 'none';

    if (newPassword !== confirmPassword) {
        if (errorBox) {
            errorBox.textContent = 'Новый пароль и его подтверждение не совпадают';
            errorBox.style.display = 'block';
        }
        return;
    }

    try {
        const res = await ApiClient.post('/api/auth/change-password', {
            currentPassword,
            newPassword,
            confirmPassword
        });

        closeChangePasswordModal();
        form.reset();
        showToast(res.message || 'Пароль успешно обновлен!', 'success');
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

function openSessionsModal() {
    document.getElementById('sessions-modal').classList.add('active');
    loadSessions();
}
function closeSessionsModal() { document.getElementById('sessions-modal').classList.remove('active'); }

// Слушатель события истечения сессии
window.addEventListener('auth:expired', () => {
    currentUser = null;
    updateAuthUI();
    showToast('Срок действия сессии истек. Войдите заново.', 'error');
    openLoginModal();
});
