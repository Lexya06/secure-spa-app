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

    updateMailboxBadge();
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
        const res = await ApiClient.post('/api/auth/forgot-password', { email });
        const token = res.resetToken || res.debugToken;
        const resetUrl = res.resetUrl || `${window.location.origin}/#reset-password?token=${token}`;

        // Скрываем поля ввода, чтобы не требовать повторный ввод email
        if (fields) fields.style.display = 'none';

        const deliveryNotice = `
            <div style="padding: 10px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; color: #1e40af; font-size: 13px; margin-bottom: 12px;">
                📬 <strong>Письмо для сброса пароля сформировано!</strong><br>
                Оно отправлено на <strong>${escapeHtml(email)}</strong>, зафиксировано в почтовом сервисе приложения (кнопка <strong>«Почта»</strong>) и продублировано ниже:
            </div>
        `;

        let html = `
            ${deliveryNotice}
            <div style="padding: 14px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 6px;">
                    🔑 Одноразовый код сброса пароля:
                </div>
                <code style="display: block; word-break: break-all; padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; color: #0f172a; margin-bottom: 12px;">${token}</code>
                
                <button type="button" class="btn btn-primary" style="width: 100%; margin-bottom: 10px;" onclick="openResetModalWithToken('${token}')">
                    🔑 Перейти к смене пароля (токен уже вставлен)
                </button>

                <div style="font-size: 12px; color: #64748b; line-height: 1.5; word-break: break-all;">
                    Прямая ссылка: <br>
                    <a href="${resetUrl}" style="color: #2563eb; text-decoration: underline;">${resetUrl}</a>
                </div>
            </div>
            
            <div style="margin-top: 14px; display: flex; justify-content: space-between; gap: 8px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="resetForgotFormState()">
                    ← Ввести другой email
                </button>
                <button type="button" class="btn btn-outline-primary btn-sm" onclick="openMailboxModalFor('${escapeHtml(email)}')">
                    📬 Открыть письмо в Почте
                </button>
            </div>
        `;

        successBox.innerHTML = html;
        successBox.style.display = 'block';
        updateMailboxBadge();
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
    closeMailboxModal();
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

function openSessionsModal() {
    document.getElementById('sessions-modal').classList.add('active');
    loadSessions();
}
function closeSessionsModal() { document.getElementById('sessions-modal').classList.remove('active'); }

/**
 * Функции встроенного почтового клиента (Входящие сообщения)
 */
let currentMailboxList = [];

async function updateMailboxBadge() {
    try {
        const res = await ApiClient.get('/api/auth/mailbox');
        const badge = document.getElementById('mailbox-badge');
        if (badge) {
            const count = res.count || (res.data ? res.data.length : 0);
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch {
        // Игнорируем фоновые ошибки
    }
}

async function loadMailbox(forEmail = null) {
    const listEl = document.getElementById('mailbox-list');
    const viewEl = document.getElementById('mailbox-view');
    if (!listEl) return;

    listEl.style.display = 'flex';
    if (viewEl) viewEl.style.display = 'none';
    listEl.innerHTML = '<p style="text-align:center; padding: 20px; color:#64748b;">Загрузка входящих писем...</p>';

    try {
        const params = forEmail ? { email: forEmail } : {};
        const res = await ApiClient.get('/api/auth/mailbox', params);
        currentMailboxList = res.data || [];

        if (currentMailboxList.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 30px 10px; color: #64748b;">
                    <div style="font-size: 32px; margin-bottom: 8px;">📭</div>
                    <strong>Входящих писем пока нет</strong>
                    <p style="font-size: 13px; margin-top: 4px;">Запросите сброс пароля через форму «Забыли пароль?», и сформированное письмо появится здесь.</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = currentMailboxList.map((m, index) => {
            const dateStr = new Date(m.sentAt).toLocaleString('ru-RU');
            const statusBadge = '<span style="font-size: 10px; background: #eff6ff; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Доставлено</span>';

            return `
                <div class="mail-item" onclick="viewMailDetail(${index})">
                    <div class="mail-item-header">
                        <span class="mail-from">От: ${escapeHtml(m.from || 'Безопасность СПП')}</span>
                        <span class="mail-date">${dateStr}</span>
                    </div>
                    <div class="mail-to">Кому: <strong>${escapeHtml(m.to)}</strong> &bull; ${statusBadge}</div>
                    <div class="mail-subject">✉️ ${escapeHtml(m.subject)}</div>
                    <div class="mail-snippet">Нажмите, чтобы прочитать письмо и сменить пароль ➔</div>
                </div>
            `;
        }).join('');

        updateMailboxBadge();
    } catch (err) {
        listEl.innerHTML = `<p class="modal-warning-text">Ошибка загрузки почты: ${err.message}</p>`;
    }
}

function viewMailDetail(index) {
    const mail = currentMailboxList[index];
    if (!mail) return;

    const listEl = document.getElementById('mailbox-list');
    const viewEl = document.getElementById('mailbox-view');
    if (!listEl || !viewEl) return;

    listEl.style.display = 'none';
    viewEl.style.display = 'block';

    const dateStr = new Date(mail.sentAt).toLocaleString('ru-RU');

    viewEl.innerHTML = `
        <div class="mail-detail-toolbar">
            <button type="button" class="btn btn-sm btn-secondary" onclick="backToMailboxList()">← Назад к списку</button>
            <span style="font-size: 12px; color: #64748b;">${dateStr}</span>
        </div>
        <div class="mail-detail-headers">
            <div><strong>Тема:</strong> ${escapeHtml(mail.subject)}</div>
            <div><strong>От:</strong> ${escapeHtml(mail.from)}</div>
            <div><strong>Кому:</strong> ${escapeHtml(mail.to)}</div>
        </div>
        <div class="mail-detail-body">
            ${mail.html || `<pre style="white-space: pre-wrap;">${escapeHtml(mail.text)}</pre>`}
        </div>
        <div class="mail-detail-actions">
            ${mail.resetToken ? `
                <button type="button" class="btn btn-primary" onclick="applyTokenFromMail('${mail.resetToken}')">
                    🔑 Сбросить пароль по этому письму
                </button>
            ` : ''}
        </div>
    `;
}

function backToMailboxList() {
    const listEl = document.getElementById('mailbox-list');
    const viewEl = document.getElementById('mailbox-view');
    if (listEl) listEl.style.display = 'flex';
    if (viewEl) viewEl.style.display = 'none';
}

function applyTokenFromMail(token) {
    closeMailboxModal();
    openResetModalWithToken(token);
}

function openMailboxModal() {
    document.getElementById('mailbox-modal').classList.add('active');
    loadMailbox();
}

function openMailboxModalFor(email) {
    closeForgotModal();
    document.getElementById('mailbox-modal').classList.add('active');
    loadMailbox(email);
}

function closeMailboxModal() {
    document.getElementById('mailbox-modal').classList.remove('active');
}

// Слушатель события истечения сессии
window.addEventListener('auth:expired', () => {
    currentUser = null;
    updateAuthUI();
    showToast('Срок действия сессии истек. Войдите заново.', 'error');
    openLoginModal();
});
