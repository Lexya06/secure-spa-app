const express = require('express');
const router = express.Router();
const AuthService = require('../services/authService');
const SessionService = require('../services/sessionService');
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');

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

        res.status(200).json({
            success: true,
            message: result.message,
            previewUrl: result.previewUrl,
            debugToken: result.debugToken
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
 */
router.get('/users', authenticateToken, (req, res) => {
    const rows = db.prepare('SELECT id, name, email, role FROM users ORDER BY name ASC').all();
    res.status(200).json({
        success: true,
        data: rows
    });
});

module.exports = router;
