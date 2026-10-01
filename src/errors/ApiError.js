/**
 * Класс ошибки API, реализующий стандарт RFC 7807 (Problem Details for HTTP APIs)
 */
class ApiError extends Error {
    constructor(status, title, detail, code = 'ERROR', errors = [], extra = {}) {
        super(detail);
        this.status = status;
        this.title = title;
        this.detail = detail;
        this.code = code;
        this.errors = errors;
        this.type = `https://httpstatuses.io/${status}`;
        this.timestamp = new Date().toISOString();
        Object.assign(this, extra);
    }

    static badRequest(detail = 'Некорректный запрос', code = 'BAD_REQUEST', errors = []) {
        return new ApiError(400, 'Bad Request', detail, code, errors);
    }

    static unauthorized(detail = 'Требуется аутентификация', code = 'UNAUTHORIZED') {
        return new ApiError(401, 'Unauthorized', detail, code);
    }

    static forbidden(detail = 'Доступ запрещен для текущей роли', code = 'FORBIDDEN') {
        return new ApiError(403, 'Forbidden', detail, code);
    }

    static notFound(detail = 'Запрашиваемый ресурс не найден', code = 'NOT_FOUND') {
        return new ApiError(404, 'Not Found', detail, code);
    }

    static conflict(detail = 'Конфликт состояния данных', code = 'CONFLICT') {
        return new ApiError(409, 'Conflict', detail, code);
    }

    static unprocessableEntity(detail = 'Ошибка семантической валидации данных', errors = [], code = 'VALIDATION_FAILED') {
        return new ApiError(422, 'Unprocessable Entity', detail, code, errors);
    }

    static tooManyRequests(detail = 'Слишком много запросов. Попробуйте позже.', retryAfterSeconds = 900, code = 'TOO_MANY_REQUESTS') {
        return new ApiError(429, 'Too Many Requests', detail, code, [], { retryAfter: retryAfterSeconds });
    }

    static internal(detail = 'Внутренняя ошибка сервера', code = 'INTERNAL_SERVER_ERROR') {
        return new ApiError(500, 'Internal Server Error', detail, code);
    }

    /**
     * Сериализация в формат Problem Details (RFC 7807)
     */
    toProblemDetails(instance = null) {
        const response = {
            type: this.type,
            title: this.title,
            status: this.status,
            detail: this.detail,
            code: this.code,
            timestamp: this.timestamp
        };

        if (instance) {
            response.instance = instance;
        }

        if (this.errors && this.errors.length > 0) {
            response.errors = this.errors;
        }

        if (this.retryAfter) {
            response.retryAfter = this.retryAfter;
        }

        return response;
    }
}

module.exports = ApiError;
