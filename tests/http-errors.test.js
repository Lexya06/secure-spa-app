const request = require('supertest');
const app = require('../src/app');

const { db } = require('../src/db');

describe('Тестирование семантики кодов ошибок HTTP и стандарта Problem Details (RFC 7807)', () => {
    let managerToken = '';

    beforeAll(async () => {
        db.prepare('UPDATE users SET is_locked = 0, locked_until = NULL').run();
        db.prepare('DELETE FROM login_attempts').run();

        const res = await request(app).post('/api/auth/login').send({
            email: 'manager@example.com',
            password: 'Manager123!'
        });
        managerToken = res.body.data.accessToken;
    });

    test('1. HTTP 400 Bad Request: Некорректный ID задачи (не число)', async () => {
        const res = await request(app)
            .get('/api/tasks/abc')
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(400);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.type).toBe('https://httpstatuses.io/400');
        expect(res.body.title).toBe('Bad Request');
        expect(res.body.instance).toBe('/api/tasks/abc');
        expect(res.body.code).toBe('INVALID_TASK_ID');
        expect(res.body.traceId).toBeDefined();
    });

    test('2. HTTP 401 Unauthorized: Не передан Bearer токен', async () => {
        const res = await request(app).get('/api/tasks');

        expect(res.status).toBe(401);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.type).toBe('https://httpstatuses.io/401');
        expect(res.body.title).toBe('Unauthorized');
        expect(res.body.code).toBe('TOKEN_MISSING');
    });

    test('3. HTTP 403 Forbidden: Попытка выполнения действия чужой роли', async () => {
        // Логинимся как исполнитель
        const eLogin = await request(app).post('/api/auth/login').send({
            email: 'executor@example.com',
            password: 'Executor123!'
        });
        const executorToken = eLogin.body.data.accessToken;

        const res = await request(app)
            .delete('/api/tasks/1')
            .set('Authorization', `Bearer ${executorToken}`);

        expect(res.status).toBe(403);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.type).toBe('https://httpstatuses.io/403');
        expect(res.body.title).toBe('Forbidden');
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    test('4. HTTP 404 Not Found: Запрос несуществующей задачи или пути', async () => {
        const res = await request(app)
            .get('/api/tasks/999999')
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(404);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.type).toBe('https://httpstatuses.io/404');
        expect(res.body.title).toBe('Not Found');
        expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    test('5. HTTP 422 Unprocessable Entity: Ошибка валидации полей', async () => {
        const res = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: '' // Пустое название
            });

        expect(res.status).toBe(422);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.type).toBe('https://httpstatuses.io/422');
        expect(res.body.title).toBe('Unprocessable Entity');
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.some(e => e.field === 'title')).toBe(true);
    });

    test('6. Заголовок X-Request-ID возвращается в каждом HTTP ответе', async () => {
        const res = await request(app).get('/api/tasks');
        expect(res.header['x-request-id']).toBeDefined();
    });
});
