const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Убеждаемся в существовании директории для логов
if (!fs.existsSync(config.LOGS_DIR)) {
    fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

// Фильтр для выделения только событий аудита безопасности
const auditFilter = winston.format((info) => {
    return (info.audit || info.action) ? info : false;
});

// Кастомный форматтер для консоли (читабельный структурированный вывод)
const consoleFormat = winston.format.printf((info) => {
    const { level, message, timestamp, requestId, userId, role, audit, action, status, ...meta } = info;
    delete meta.service;
    const reqStr = requestId ? ` \x1b[36m[Req: ${requestId.substring(0, 8)}]\x1b[0m` : '';
    const userStr = userId ? ` \x1b[35m[User: #${userId}${role ? ' (' + role + ')' : ''}]\x1b[0m` : '';
    const auditBadge = audit ? ` \x1b[33m[AUDIT: ${action || 'EVENT'}${status ? ' ' + status : ''}]\x1b[0m` : '';
    let metaStr = '';
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
        metaStr = ` \x1b[90m${JSON.stringify(meta)}\x1b[0m`;
    }
    return `\x1b[90m${timestamp}\x1b[0m [${level}]${reqStr}${userStr}${auditBadge}: ${message}${metaStr}`;
});

// Формат вывода в консоль (структурированный JSON или форматированный цветной текст)
const consoleTransportFormat = process.env.LOG_FORMAT === 'json'
    ? winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.json()
    )
    : winston.format.combine(
        winston.format.colorize({ all: false }),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
    );

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
            maxFiles: 5,
            format: winston.format.combine(
                auditFilter(),
                winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
                winston.format.json()
            )
        })
    ]
});

// В среде разработки и тестирования дублируем в консоль
if (config.NODE_ENV !== 'test') {
    logger.add(new winston.transports.Console({
        format: consoleTransportFormat
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
