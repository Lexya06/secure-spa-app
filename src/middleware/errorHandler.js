const multer = require('multer');
const ApiError = require('../errors/ApiError');
const logger = require('../logger');

/**
 * Централизованный обработчик ошибок в стандарте RFC 7807 (Problem Details)
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    const instance = req.originalUrl || req.url;
    let apiError;

    if (err instanceof ApiError) {
        apiError = err;
    } else if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            apiError = new ApiError(413, 'Payload Too Large', 'Размер прикрепленного файла превышает максимально допустимый лимит (15 МБ)', 'FILE_TOO_LARGE');
        } else {
            apiError = ApiError.badRequest(`Ошибка при загрузке файла: ${err.message}`, 'FILE_UPLOAD_ERROR');
        }
    } else if (err.type === 'entity.parse.failed') {
        apiError = ApiError.badRequest('Синтаксическая ошибка в переданном теле JSON', 'INVALID_JSON_BODY');
    } else {
        // Непредвиденные системные ошибки (500)
        logger.error('Непредвиденная ошибка приложения:', {
            requestId: req.requestId,
            error: err.message,
            stack: err.stack,
            url: instance,
            method: req.method
        });

        apiError = ApiError.internal('Произошла непредвиденная внутренняя ошибка сервера. Обратитесь к администратору.');
    }

    const problemDetails = apiError.toProblemDetails(instance);
    problemDetails.traceId = req.requestId;

    if (apiError.retryAfter) {
        res.setHeader('Retry-After', apiError.retryAfter);
    }

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(apiError.status).json(problemDetails);
}

module.exports = errorHandler;
