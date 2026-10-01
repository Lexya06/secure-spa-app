/**
 * Клиентский модуль для выполнения HTTP запросов к REST API
 * Поддерживает JWT временные ключи, авто-ротацию токенов (refresh)
 * и стандарт Problem Details (RFC 7807)
 */
class ApiClient {
    static getAccessToken() {
        return localStorage.getItem('access_token');
    }

    static getRefreshToken() {
        return localStorage.getItem('refresh_token');
    }

    static setTokens(accessToken, refreshToken) {
        if (accessToken) localStorage.setItem('access_token', accessToken);
        if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
    }

    static clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_info');
    }

    /**
     * Основной метод запроса
     */
    static async request(endpoint, options = {}, isRetry = false) {
        const url = endpoint.startsWith('http') ? endpoint : endpoint;
        const headers = options.headers ? { ...options.headers } : {};

        // Прикрепляем временный ключ доступа, если есть
        const token = this.getAccessToken();
        if (token && !headers['Authorization']) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Автоматически ставим Accept: application/json, application/problem+json
        if (!headers['Accept']) {
            headers['Accept'] = 'application/json, application/problem+json';
        }

        // Если передаем объект и не FormData, сериализуем в JSON
        let body = options.body;
        if (body && !(body instanceof FormData) && typeof body === 'object') {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                body
            });

            // Автоматическое обновление токена при истечении (401 + TOKEN_EXPIRED)
            if (response.status === 401 && !isRetry && !endpoint.includes('/auth/')) {
                const refreshToken = this.getRefreshToken();
                if (refreshToken) {
                    const refreshed = await this.refreshTokens(refreshToken);
                    if (refreshed) {
                        return this.request(endpoint, options, true);
                    }
                }
            }

            // Обработка 204 No Content
            if (response.status === 204) {
                return { success: true };
            }

            const contentType = response.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json') || contentType.includes('application/problem+json');
            const data = isJson ? await response.json() : await response.text();

            if (!response.ok) {
                const error = new Error(data.detail || data.message || `Ошибка сервера HTTP ${response.status}`);
                error.status = response.status;
                error.code = data.code || 'UNKNOWN_ERROR';
                error.problemDetails = data;
                error.errors = data.errors || [];
                error.retryAfter = data.retryAfter || response.headers.get('retry-after');
                throw error;
            }

            return data;
        } catch (err) {
            throw err;
        }
    }

    /**
     * Фоновое обновление временного ключа доступа через Refresh Token
     */
    static async refreshTokens(refreshToken) {
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!res.ok) {
                this.clearTokens();
                window.dispatchEvent(new CustomEvent('auth:expired'));
                return false;
            }

            const json = await res.json();
            if (json.data && json.data.accessToken) {
                this.setTokens(json.data.accessToken, json.data.refreshToken);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    // Вспомогательные CRUD методы
    static get(endpoint, params = {}) {
        const query = new URLSearchParams(params).toString();
        const url = query ? `${endpoint}?${query}` : endpoint;
        return this.request(url, { method: 'GET' });
    }

    static post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', body });
    }

    static put(endpoint, body) {
        return this.request(endpoint, { method: 'PUT', body });
    }

    static patch(endpoint, body) {
        return this.request(endpoint, { method: 'PATCH', body });
    }

    static delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}
