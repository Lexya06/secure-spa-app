const express = require('express');
const router = express.Router();
const AuthService = require('../services/authService');
const SessionService = require('../services/sessionService');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const ApiError = require('../errors/ApiError');
const logger = require('../logger');
const { db } = require('../db');
const mailer = require('../mailer');

/**
 * 1. Регистрация нового пользователя
 * POST /api/auth/register (201 Created)
 */
router.post('/register', async (req, res, next) => {
    try {
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const result = await AuthService.register(req.body, { ipAddress, userAgent });

        res.status(201).json({
            success: true,
            message: 'Пользователь успешно зарегистрирован',
            data: result
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 2. Вход в систему (получение временных ключей)
 * POST /api/auth/login (200 OK)
 */
router.post('/login', async (req, res, next) => {
    try {
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const result = await AuthService.login(req.body, { ipAddress, userAgent });

        res.status(200).json({
            success: true,
            message: 'Успешная аутентификация',
            data: result
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 3. Обновление временного ключа доступа (Refresh Token)
 * POST /api/auth/refresh (200 OK)
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const result = await AuthService.refreshAccessToken(refreshToken, { ipAddress, userAgent });

        res.status(200).json({
            success: true,
            message: 'Временный ключ успешно обновлен',
            data: result
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 4. Получение данных текущего пользователя
 * GET /api/auth/me (200 OK)
 */
router.get('/me', authenticateToken, (req, res) => {
    res.status(200).json({
        success: true,
        data: req.user
    });
});

/**
 * 5. Контроль активных подключений: просмотр всех активных сессий
 * GET /api/auth/sessions (200 OK)
 */
router.get('/sessions', authenticateToken, (req, res, next) => {
    try {
        const sessions = SessionService.getUserSessions(req.user.id, req.user.sessionId);
        res.status(200).json({
            success: true,
            count: sessions.length,
            data: sessions
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 6. Контроль активных подключений: отзыв конкретной сессии
 * DELETE /api/auth/sessions/:id (200 OK)
 */
router.delete('/sessions/:id', authenticateToken, (req, res, next) => {
    try {
        const sessionId = req.params.id;
        SessionService.revokeSession(sessionId, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Сессия успешно отозвана'
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 7. Контроль активных подключений: отзыв всех других сессий
 * POST /api/auth/sessions/revoke-others (200 OK)
 */
router.post('/sessions/revoke-others', authenticateToken, (req, res, next) => {
    try {
        const result = SessionService.revokeOtherSessions(req.user.id, req.user.sessionId);
        res.status(200).json({
            success: true,
            message: `Отозвано других сессий: ${result.revokedCount}`,
            data: result
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 8. Выход из системы (отзыв текущей сессии)
 * POST /api/auth/logout (200 OK)
 */
router.post('/logout', authenticateToken, (req, res, next) => {
    try {
        if (req.user.sessionId) {
            SessionService.revokeSession(req.user.sessionId, req.user.id);
        }
        res.status(200).json({
            success: true,
            message: 'Вы успешно вышли из системы'
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 9. Запрос восстановления доступа через email
 * POST /api/auth/forgot-password (200 OK)
 */
router.post('/forgot-password', async (req, res, next) => {
    try {
        const { email } = req.body;
        const protocol = req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        const result = await AuthService.forgotPassword(email, baseUrl);

        const responsePayload = {
            success: true,
            message: result.message,
            deliveryMethod: result.deliveryMethod
        };

        // В среде Jest тестов возвращаем debugToken для тестирования процесса
        if (process.env.NODE_ENV === 'test' && result.debugToken) {
            responsePayload.debugToken = result.debugToken;
        }

        res.status(200).json(responsePayload);
    } catch (err) {
        next(err);
    }
});

/**
 * 9.1. Получение писем из личного почтового ящика текущего пользователя
 * GET /api/auth/mailbox (200 OK)
 * Строго требует аутентификации и отдает письма ТОЛЬКО для личной почты вошедшего пользователя!
 */
router.get('/mailbox', authenticateToken, (req, res) => {
    const emails = mailer.getSentEmails(req.user.email);
    res.status(200).json({
        success: true,
        count: emails.length,
        data: emails
    });
});

/**
 * 9.2. Смена пароля текущим пользователем для своей учетной записи
 * POST /api/auth/change-password (200 OK)
 */
router.post('/change-password', authenticateToken, async (req, res, next) => {
    try {
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const result = await AuthService.changePassword(
            req.user.id,
            req.body,
            { ipAddress, sessionId: req.user.sessionId }
        );

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 10. Завершение сброса пароля по одноразовому токену
 * POST /api/auth/reset-password (200 OK)
 */
router.post('/reset-password', async (req, res, next) => {
    try {
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const result = await AuthService.resetPassword(req.body, { ipAddress });

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 11. Получение списка пользователей (для выбора исполнителей и проверяющих)
 * GET /api/auth/users (200 OK)
 * Приватная почта пользователей скрыта для соблюдения конфиденциальности
 */
router.get('/users', authenticateToken, (req, res) => {
    const rows = db.prepare('SELECT id, name, role FROM users ORDER BY name ASC').all();
    res.status(200).json({
        success: true,
        data: rows
    });
});

/**
 * 12. Назначение / смена роли пользователя руководителем (RBAC)
 * PATCH /api/auth/users/:id/role
 */
router.patch('/users/:id/role', authenticateToken, requireRoles('manager'), (req, res, next) => {
    try {
        const targetUserId = req.params.id;
        const { role } = req.body;
        const allowedRoles = ['manager', 'executor', 'reviewer'];

        if (!role || !allowedRoles.includes(role)) {
            return next(ApiError.badRequest(`Недопустимая роль. Допустимы: ${allowedRoles.join(', ')}`, 'INVALID_ROLE'));
        }

        const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(targetUserId);
        if (!user) {
            return next(ApiError.notFound('Пользователь не найден', 'USER_NOT_FOUND'));
        }

        db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, targetUserId);

        logger.audit('USER_ROLE_CHANGED', {
            manager: { id: req.user.id, email: req.user.email },
            targetUser: { id: user.id, email: user.email, oldRole: user.role, newRole: role }
        });

        res.status(200).json({
            success: true,
            message: `Роль пользователя ${user.name} успешно изменена на "${role}"`,
            data: { id: user.id, role }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
