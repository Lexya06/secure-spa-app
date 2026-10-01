const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Убеждаемся в существовании директории для логов
if (!fs.existsSync(config.LOGS_DIR)) {
    fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

// Кастомный форматтер для консоли (читабельный)
const consoleFormat = winston.format.printf(({ level, message, timestamp, requestId, userId, role, ...meta }) => {
    const reqStr = requestId ? ` [Req: ${requestId.substring(0, 8)}]` : '';
    const userStr = userId ? ` [User: #${userId} (${role || 'none'})]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}]${reqStr}${userStr}: ${message}${metaStr}`;
});

// Настройка Winston с JSON сериализацией для файлов (структурированное логирование)
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'task-manager-api' },
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        // Все логи в формате JSON
        new winston.transports.File({
            filename: path.join(config.LOGS_DIR, 'combined.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        }),
        // Только ошибки
        new winston.transports.File({
            filename: path.join(config.LOGS_DIR, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5
        }),
        // Логи событий безопасности и аудита (Audit Trail)
        new winston.transports.File({
            filename: path.join(config.LOGS_DIR, 'audit.log'),
            level: 'info',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        })
    ]
});

// В среде разработки и тестирования дублируем в консоль
if (config.NODE_ENV !== 'test') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            consoleFormat
        )
    }));
}

// Специальный метод для логирования событий аудита безопасности
logger.audit = function (action, { req, user, details = {}, ip, status = 'SUCCESS' } = {}) {
    const auditEntry = {
        audit: true,
        action,
        status,
        timestamp: new Date().toISOString(),
        requestId: req ? req.requestId : undefined,
        ip: ip || (req ? req.ip || req.connection?.remoteAddress : 'internal'),
        userAgent: req ? req.headers['user-agent'] : undefined,
        user: user || (req && req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null),
        details
    };

    logger.info(`[AUDIT] ${action} (${status})`, auditEntry);
};

module.exports = logger;
