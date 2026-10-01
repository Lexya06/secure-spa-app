const crypto = require('crypto');
const logger = require('../logger');

/**
 * Middleware структурированного логирования HTTP-запросов и ответов
 * с генерацией сквозного Correlation/Request ID
 */
function requestLogger(req, res, next) {
    // Получаем или генерируем Request ID
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    const startTime = process.hrtime();

    res.on('finish', () => {
        const diff = process.hrtime(startTime);
        const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);

        const logData = {
            requestId,
            method: req.method,
            url: req.originalUrl || req.url,
            statusCode: res.statusCode,
            durationMs: Number(durationMs),
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers['user-agent'],
            userId: req.user ? req.user.id : null,
            role: req.user ? req.user.role : null
        };

        if (res.statusCode >= 500) {
            logger.error(`HTTP ${req.method} ${req.originalUrl} ${res.statusCode} [${durationMs}ms]`, logData);
        } else if (res.statusCode >= 400) {
            logger.warn(`HTTP ${req.method} ${req.originalUrl} ${res.statusCode} [${durationMs}ms]`, logData);
        } else {
            logger.info(`HTTP ${req.method} ${req.originalUrl} ${res.statusCode} [${durationMs}ms]`, logData);
        }
    });

    next();
}

module.exports = requestLogger;
