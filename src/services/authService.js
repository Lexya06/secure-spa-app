const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const ApiError = require('../errors/ApiError');
const logger = require('../logger');
const SessionService = require('./sessionService');
const { sendPasswordResetEmail } = require('../mailer');

class AuthService {
    /**
     * Генерация временного ключа доступа (Access Token)
     */
    static generateAccessToken(user, sessionId) {
        return jwt.sign(
            {
                sub: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                sessionId
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );
    }

    /**
     * Генерация токена обновления (Refresh Token)
     */
    static generateRefreshToken() {
        return crypto.randomBytes(40).toString('hex');
    }

    /**
     * Проверка блокировки аккаунта/IP при подборе пароля (Brute-Force Protection)
     */
    static checkBruteForceLockout(email, ip) {
        // 1. Проверяем блокировку пользователя в таблице users
        const user = db.prepare('SELECT id, is_locked, locked_until FROM users WHERE email = ?').get(email);

        if (user && user.is_locked && user.locked_until) {
            const checkLock = db.prepare(`
                SELECT CAST((strftime('%s', locked_until) - strftime('%s', 'now')) AS INTEGER) as remaining
                FROM users
                WHERE id = ? AND locked_until > datetime('now')
            `).get(user.id);

            if (checkLock && checkLock.remaining > 0) {
                const remainingSeconds = checkLock.remaining;
                logger.audit('LOGIN_BLOCKED_ACCOUNT_LOCKED', {
                    user: { id: user.id, email },
                    ip,
                    status: 'BLOCKED',
                    details: { remainingSeconds }
                });
                throw ApiError.tooManyRequests(
                    `Учетная запись временно заблокирована из-за многократных неудачных попыток входа. Повторите попытку через ${remainingSeconds} сек.`,
                    remainingSeconds,
                    'ACCOUNT_LOCKED'
                );
            } else {
                // Срок блокировки истек — снимаем
                db.prepare('UPDATE users SET is_locked = 0, locked_until = NULL WHERE id = ?').run(user.id);
            }
        }

        // 2. Проверяем количество неудачных попыток за последние 15 минут по Email
        const attempts = db.prepare(`
            SELECT COUNT(*) as count
            FROM login_attempts
            WHERE email = ?
              AND success = 0
              AND attempt_time >= datetime('now', '-' || ? || ' minutes')
        `).get(email, config.LOCKOUT_WINDOW_MINUTES);

        if (attempts.count >= config.MAX_LOGIN_ATTEMPTS) {
            // Блокируем пользователя, если он существует
            if (user) {
                db.prepare(`
                    UPDATE users
                    SET is_locked = 1, locked_until = datetime('now', '+' || ? || ' minutes')
                    WHERE id = ?
                `).run(config.LOCKOUT_WINDOW_MINUTES, user.id);
            }

            const remainingSeconds = config.LOCKOUT_WINDOW_MINUTES * 60;
            logger.audit('LOGIN_BLOCKED_TOO_MANY_ATTEMPTS', {
                email,
                ip,
                status: 'BLOCKED',
                details: { failedAttempts: attempts.count, remainingSeconds }
            });

            throw ApiError.tooManyRequests(
                `Превышено максимальное число попыток входа (${config.MAX_LOGIN_ATTEMPTS}). Доступ временно заблокирован на ${config.LOCKOUT_WINDOW_MINUTES} мин.`,
                remainingSeconds,
                'TOO_MANY_ATTEMPTS'
            );
        }
    }

    /**
     * Фиксация попытки входа в журнал безопасности
     */
    static recordLoginAttempt(ip, email, success) {
        db.prepare(`
            INSERT INTO login_attempts (ip_address, email, success)
            VALUES (?, ?, ?)
        `).run(ip, email, success ? 1 : 0);

        if (success) {
            // Очищаем старые неудачные попытки при успешном входе
            db.prepare('DELETE FROM login_attempts WHERE email = ? AND success = 0').run(email);
        }
    }

    /**
     * Валидация сложности пароля
     */
    static validatePasswordStrength(password) {
        if (!password || typeof password !== 'string') {
            return { valid: false, message: 'Пароль обязателен' };
        }
        if (password.length < 8) {
            return { valid: false, message: 'Пароль должен содержать не менее 8 символов' };
        }
        if (!/[A-Z]/.test(password)) {
            return { valid: false, message: 'Пароль должен содержать хотя бы одну заглавную букву (A-Z)' };
        }
        if (!/[a-z]/.test(password)) {
            return { valid: false, message: 'Пароль должен содержать хотя бы одну строчную букву (a-z)' };
        }
        if (!/[0-9]/.test(password)) {
            return { valid: false, message: 'Пароль должен содержать хотя бы одну цифру (0-9)' };
        }
        return { valid: true };
    }

    /**
     * Регистрация нового пользователя
     */
    static async register({ name, email, password, role }, { ipAddress, userAgent }) {
        if (!name || name.trim().length < 2) {
            throw ApiError.unprocessableEntity('Имя пользователя должно содержать не менее 2 символов', [
                { field: 'name', message: 'Минимум 2 символа' }
            ]);
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email.trim())) {
            throw ApiError.unprocessableEntity('Некорректный адрес электронной почты', [
                { field: 'email', message: 'Введите валидный email' }
            ]);
        }

        const passCheck = this.validatePasswordStrength(password);
        if (!passCheck.valid) {
            throw ApiError.unprocessableEntity(passCheck.message, [
                { field: 'password', message: passCheck.message }
            ]);
        }

        const allowedRoles = Object.values(config.ROLES);
        if (!role || !allowedRoles.includes(role)) {
            throw ApiError.unprocessableEntity(`Недопустимая роль. Допустимы: ${allowedRoles.join(', ')}`, [
                { field: 'role', message: `Допустимы: ${allowedRoles.join(', ')}` }
            ]);
        }

        // Проверка уникальности email
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
        if (existing) {
            throw ApiError.conflict('Пользователь с таким адресом электронной почты уже зарегистрирован', 'EMAIL_ALREADY_EXISTS');
        }

        const passwordHash = bcrypt.hashSync(password, config.BCRYPT_SALT_ROUNDS);

        const insertStmt = db.prepare(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
        `);
        const result = insertStmt.run(name.trim(), email.trim(), passwordHash, role);

        const newUser = {
            id: result.lastInsertRowid,
            name: name.trim(),
            email: email.trim(),
            role
        };

        // Создаем первую сессию
        const refreshToken = this.generateRefreshToken();
        const session = SessionService.createSession({
            userId: newUser.id,
            refreshToken,
            ipAddress,
            userAgent
        });

        const accessToken = this.generateAccessToken(newUser, session.sessionId);

        logger.audit('USER_REGISTERED', {
            user: newUser,
            ip: ipAddress,
            details: { role }
        });

        return {
            user: newUser,
            accessToken,
            refreshToken,
            session
        };
    }

    /**
     * Аутентификация пользователя (Вход в систему)
     */
    static async login({ email, password }, { ipAddress, userAgent }) {
        if (!email || !password) {
            throw ApiError.badRequest('Email и пароль обязательны', 'MISSING_CREDENTIALS');
        }

        const cleanEmail = email.trim().toLowerCase();

        // Проверка на подбор паролей (Brute-Force Lockout)
        this.checkBruteForceLockout(cleanEmail, ipAddress);

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

        if (!user) {
            this.recordLoginAttempt(ipAddress, cleanEmail, false);
            logger.audit('LOGIN_FAILED_UNKNOWN_USER', {
                email: cleanEmail,
                ip: ipAddress,
                status: 'FAILED'
            });
            throw ApiError.unauthorized('Неверный адрес электронной почты или пароль', 'INVALID_CREDENTIALS');
        }

        const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
        if (!isPasswordValid) {
            this.recordLoginAttempt(ipAddress, cleanEmail, false);
            logger.audit('LOGIN_FAILED_WRONG_PASSWORD', {
                user: { id: user.id, email: user.email, role: user.role },
                ip: ipAddress,
                status: 'FAILED'
            });
            throw ApiError.unauthorized('Неверный адрес электронной почты или пароль', 'INVALID_CREDENTIALS');
        }

        // Успешный вход
        this.recordLoginAttempt(ipAddress, cleanEmail, true);

        // Создаем новую сессию для устройства
        const refreshToken = this.generateRefreshToken();
        const session = SessionService.createSession({
            userId: user.id,
            refreshToken,
            ipAddress,
            userAgent
        });

        const safeUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        };

        const accessToken = this.generateAccessToken(safeUser, session.sessionId);

        logger.audit('LOGIN_SUCCESS', {
            user: safeUser,
            ip: ipAddress,
            details: { sessionId: session.sessionId, deviceName: session.deviceName }
        });

        return {
            user: safeUser,
            accessToken,
            refreshToken,
            session
        };
    }

    /**
     * Обновление временного ключа доступа по Refresh Token (Token Rotation)
     */
    static async refreshAccessToken(refreshToken, { ipAddress, _userAgent }) {
        if (!refreshToken) {
            throw ApiError.unauthorized('Refresh токен не передан', 'TOKEN_MISSING');
        }

        const session = SessionService.findValidSessionByToken(refreshToken);
        if (!session) {
            throw ApiError.unauthorized('Недействительный или отозванный токен обновления. Войдите заново.', 'SESSION_INVALID');
        }

        // Проверяем, не заблокирован ли пользователь
        if (session.is_locked) {
            throw ApiError.forbidden('Учетная запись заблокирована', 'ACCOUNT_LOCKED');
        }

        const safeUser = {
            id: session.user_id,
            name: session.name,
            email: session.email,
            role: session.role
        };

        // Ротация: выдаем новый refresh токен и обновляем сессию
        const newRefreshToken = this.generateRefreshToken();
        SessionService.updateSessionToken(session.id, newRefreshToken);

        const newAccessToken = this.generateAccessToken(safeUser, session.id);

        logger.audit('TOKEN_REFRESHED', {
            user: safeUser,
            ip: ipAddress,
            details: { sessionId: session.id }
        });

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: safeUser
        };
    }

    /**
     * Запрос на восстановление доступа через email
     */
    static async forgotPassword(email, reqBaseUrl) {
        if (!email) {
            throw ApiError.badRequest('Email обязателен для сброса пароля', 'MISSING_EMAIL');
        }

        const cleanEmail = email.trim().toLowerCase();
        const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(cleanEmail);

        if (!user) {
            logger.warn(`[FORGOT PASSWORD] Запрос сброса для незарегистрированного email: ${cleanEmail}`);
            throw ApiError.notFound(
                `Пользователь с адресом "${cleanEmail}" не найден в системе. Пожалуйста, сначала зарегистрируйтесь через форму регистрации.`,
                'USER_NOT_FOUND'
            );
        }

        // Аннулируем предыдущие неиспользованные токены сброса для этого пользователя
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);

        // Генерируем криптостойкий токен
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + config.PASSWORD_RESET_EXPIRES_MINUTES);

        db.prepare(`
            INSERT INTO password_resets (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, tokenHash, expiresAt.toISOString());

        const resetUrl = `${reqBaseUrl}/#reset-password?token=${rawToken}`;
        let mailResult = null;
        try {
            mailResult = await sendPasswordResetEmail(user.email, rawToken, resetUrl);
        } catch (mailErr) {
            logger.warn(`[FORGOT PASSWORD] Ошибка отправки письма: ${mailErr.message}`);
        }

        logger.audit('PASSWORD_RESET_REQUESTED', {
            user: { id: user.id, email: user.email },
            details: { resetToken: rawToken }
        });

        console.log('\n======================================================');
        console.log(`[СБРОС ПАРОЛЯ] Запрос для: ${user.email}`);
        console.log(`[ТОКЕН ВОССТАНОВЛЕНИЯ]: ${rawToken}`);
        console.log(`[ССЫЛКА ДЛЯ СБРОСА]: ${resetUrl}`);
        console.log('======================================================\n');

        return {
            message: `Письмо для восстановления доступа успешно сформировано для ${user.email}`,
            email: user.email,
            debugToken: rawToken,
            resetToken: rawToken,
            resetUrl,
            emailRecord: mailResult ? mailResult.emailRecord : null
        };
    }

    /**
     * Сброс пароля по одноразовому токену
     */
    static async resetPassword({ token, newPassword }, { ipAddress }) {
        if (!token) {
            throw ApiError.badRequest('Токен сброса пароля не предоставлен', 'MISSING_TOKEN');
        }

        const passCheck = this.validatePasswordStrength(newPassword);
        if (!passCheck.valid) {
            throw ApiError.unprocessableEntity(passCheck.message, [
                { field: 'newPassword', message: passCheck.message }
            ]);
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const resetRecord = db.prepare(`
            SELECT * FROM password_resets
            WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        `).get(tokenHash);

        if (!resetRecord) {
            throw ApiError.badRequest('Недействительный или истекший токен восстановления пароля', 'INVALID_RESET_TOKEN');
        }

        const newHash = bcrypt.hashSync(newPassword, config.BCRYPT_SALT_ROUNDS);

        // Обновляем пароль пользователя и разблокируем аккаунт, если был заблокирован
        db.prepare(`
            UPDATE users
            SET password_hash = ?, is_locked = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(newHash, resetRecord.user_id);

        // Помечаем токен как использованный
        db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(resetRecord.id);

        // БЕЗОПАСНОСТЬ: инвалидируем все существующие активные сессии пользователя
        SessionService.revokeAllUserSessions(resetRecord.user_id);

        logger.audit('PASSWORD_RESET_COMPLETED', {
            user: { id: resetRecord.user_id },
            ip: ipAddress,
            details: { message: 'Пароль успешно сброшен, все сессии отозваны' }
        });

        return {
            message: 'Пароль успешно изменен. Войдите с новым паролем.'
        };
    }
}

module.exports = AuthService;
