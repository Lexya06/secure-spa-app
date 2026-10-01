const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const ApiError = require('../errors/ApiError');

/**
 * Middleware проверки временного ключа доступа (JWT Access Token)
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return next(ApiError.unauthorized('Заголовок авторизации Authorization отсутствует', 'TOKEN_MISSING'));
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return next(ApiError.unauthorized('Некорректный формат токена. Ожидается: Bearer <token>', 'TOKEN_MALFORMED'));
    }

    const token = parts[1];

    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return next(ApiError.unauthorized('Срок действия временного ключа доступа истек. Используйте refresh токен.', 'TOKEN_EXPIRED'));
            }
            return next(ApiError.unauthorized('Недействительная цифровая подпись временного ключа', 'TOKEN_INVALID'));
        }

        // Проверяем, существует ли пользователь и не заблокирован ли он
        const user = db.prepare('SELECT id, name, email, role, is_locked FROM users WHERE id = ?').get(decoded.sub);
        if (!user) {
            return next(ApiError.unauthorized('Пользователь данного токена больше не существует', 'USER_NOT_FOUND'));
        }

        if (user.is_locked) {
            return next(ApiError.forbidden('Учетная запись заблокирована', 'ACCOUNT_LOCKED'));
        }

        // Проверяем, активна ли еще сессия, с которой был выдан токен
        if (decoded.sessionId) {
            const session = db.prepare('SELECT is_revoked, expires_at FROM active_sessions WHERE id = ?').get(decoded.sessionId);
            if (!session || session.is_revoked || new Date(session.expires_at) < new Date()) {
                return next(ApiError.unauthorized('Сессия этого устройства была завершена или отозвана. Войдите заново.', 'SESSION_REVOKED'));
            }
        }

        req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            sessionId: decoded.sessionId
        };

        next();
    });
}

/**
 * Middleware ролевого разграничения доступа (RBAC)
 * @param  {...string} allowedRoles Список разрешенных ролей (manager, executor, reviewer)
 */
function requireRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return next(ApiError.unauthorized('Пользователь не аутентифицирован', 'UNAUTHORIZED'));
        }

        if (!allowedRoles.includes(req.user.role)) {
            return next(ApiError.forbidden(
                `Недостаточно прав доступа. Требуется одна из ролей: [${allowedRoles.join(', ')}]. Ваша роль: '${req.user.role}'`,
                'FORBIDDEN_ROLE'
            ));
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    requireRoles
};
