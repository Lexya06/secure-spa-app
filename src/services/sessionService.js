const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const ApiError = require('../errors/ApiError');
const logger = require('../logger');

function parseDeviceName(userAgent = '') {
    if (!userAgent) return 'Неизвестное устройство';
    if (userAgent.includes('Mobile')) {
        if (userAgent.includes('Android')) return 'Android Mobile';
        if (userAgent.includes('iPhone')) return 'Apple iPhone';
        return 'Мобильное устройство';
    }
    if (userAgent.includes('Windows')) return 'Windows PC';
    if (userAgent.includes('Macintosh')) return 'macOS Workstation';
    if (userAgent.includes('Linux')) return 'Linux PC';
    return 'Браузер / Web-клиент';
}

class SessionService {
    /**
     * Создание новой активной сессии пользователя
     */
    static createSession({ userId, refreshToken, ipAddress, userAgent }) {
        const sessionId = crypto.randomUUID();
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const deviceName = parseDeviceName(userAgent);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + config.REFRESH_TOKEN_EXPIRES_DAYS);

        const stmt = db.prepare(`
            INSERT INTO active_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, device_name, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(sessionId, userId, refreshTokenHash, ipAddress, userAgent || '', deviceName, expiresAt.toISOString());

        return {
            sessionId,
            deviceName,
            expiresAt
        };
    }

    /**
     * Проверка активности сессии по хэшу токена обновления
     */
    static findValidSessionByToken(refreshToken) {
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const stmt = db.prepare(`
            SELECT s.*, u.id as user_id, u.name, u.email, u.role, u.is_locked, u.locked_until
            FROM active_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.refresh_token_hash = ? AND s.is_revoked = 0 AND s.expires_at > CURRENT_TIMESTAMP
        `);
        return stmt.get(refreshTokenHash);
    }

    /**
     * Обновление активности и замена токена сессии (ротация токенов)
     */
    static updateSessionToken(sessionId, newRefreshToken) {
        const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
        const newExpires = new Date();
        newExpires.setDate(newExpires.getDate() + config.REFRESH_TOKEN_EXPIRES_DAYS);

        const stmt = db.prepare(`
            UPDATE active_sessions
            SET refresh_token_hash = ?, last_active_at = CURRENT_TIMESTAMP, expires_at = ?
            WHERE id = ? AND is_revoked = 0
        `);
        stmt.run(newHash, newExpires.toISOString(), sessionId);
    }

    /**
     * Получение всех активных сессий пользователя
     */
    static getUserSessions(userId, currentSessionId) {
        const stmt = db.prepare(`
            SELECT id, ip_address, user_agent, device_name, created_at, last_active_at, expires_at
            FROM active_sessions
            WHERE user_id = ? AND is_revoked = 0 AND expires_at > CURRENT_TIMESTAMP
            ORDER BY last_active_at DESC
        `);

        const rows = stmt.all(userId);
        return rows.map(s => ({
            id: s.id,
            ipAddress: s.ip_address,
            userAgent: s.user_agent,
            deviceName: s.device_name,
            createdAt: s.created_at,
            lastActiveAt: s.last_active_at,
            isCurrent: s.id === currentSessionId
        }));
    }

    /**
     * Отзыв конкретной сессии по ID
     */
    static revokeSession(sessionId, userId) {
        const session = db.prepare('SELECT * FROM active_sessions WHERE id = ?').get(sessionId);
        if (!session) {
            throw ApiError.notFound('Сессия не найдена', 'SESSION_NOT_FOUND');
        }

        // Проверяем принадлежность сессии пользователю
        if (session.user_id !== userId) {
            throw ApiError.forbidden('Нельзя отозвать чужую сессию', 'SESSION_FORBIDDEN');
        }

        db.prepare('UPDATE active_sessions SET is_revoked = 1 WHERE id = ?').run(sessionId);

        logger.audit('SESSION_REVOKED', {
            user: { id: userId },
            details: { revokedSessionId: sessionId }
        });

        return true;
    }

    /**
     * Отзыв всех остальных сессий пользователя (выйти со всех других устройств)
     */
    static revokeOtherSessions(userId, currentSessionId) {
        const stmt = db.prepare(`
            UPDATE active_sessions
            SET is_revoked = 1
            WHERE user_id = ? AND id != ? AND is_revoked = 0
        `);
        const result = stmt.run(userId, currentSessionId);

        logger.audit('SESSIONS_REVOKE_OTHERS', {
            user: { id: userId },
            details: { revokedCount: result.changes }
        });

        return { revokedCount: result.changes };
    }

    /**
     * Отзыв вообще всех сессий пользователя (например, после сброса пароля)
     */
    static revokeAllUserSessions(userId) {
        const stmt = db.prepare(`
            UPDATE active_sessions
            SET is_revoked = 1
            WHERE user_id = ? AND is_revoked = 0
        `);
        const result = stmt.run(userId);

        logger.audit('ALL_SESSIONS_REVOKED', {
            user: { id: userId },
            details: { revokedCount: result.changes }
        });

        return { revokedCount: result.changes };
    }
}

module.exports = SessionService;
