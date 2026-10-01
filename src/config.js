const path = require('path');

module.exports = {
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'secure_todo.db'),
    UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
    LOGS_DIR: process.env.LOGS_DIR || path.join(__dirname, '..', 'logs'),

    // JWT Временные ключи
    JWT_SECRET: process.env.JWT_SECRET || 'lab3-super-secret-access-token-key-2026',
    JWT_EXPIRES_IN: '15m', // Срок жизни временного ключа доступа (15 минут)

    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'lab3-super-secret-refresh-token-key-2026',
    REFRESH_TOKEN_EXPIRES_DAYS: 7, // Срок жизни токена обновления (7 дней)

    // Параметры безопасности
    BCRYPT_SALT_ROUNDS: 10,
    MAX_LOGIN_ATTEMPTS: 5,         // Порог попыток подбора учетных данных
    LOCKOUT_WINDOW_MINUTES: 15,    // Время блокировки при превышении попыток (15 минут)
    PASSWORD_RESET_EXPIRES_MINUTES: 15, // Срок действия ссылки сброса пароля

    // 3 Роли пользователей согласно заданию
    ROLES: {
        MANAGER: 'manager',     // Руководитель: полный контроль, распределение задач, аудит
        EXECUTOR: 'executor',   // Исполнитель: берет в работу, отправляет на проверку
        REVIEWER: 'reviewer'    // Проверяющий: проверяет и утверждает или возвращает на доработку
    },

    // Статусы задач
    TASK_STATUSES: {
        PENDING: 'pending',         // Ожидает исполнителя
        IN_PROGRESS: 'in_progress', // В работе
        IN_REVIEW: 'in_review',     // Передано на проверку
        COMPLETED: 'completed',     // Проверено и принято
        REJECTED: 'rejected'        // Отклонено / возвращено на доработку
    }
};
