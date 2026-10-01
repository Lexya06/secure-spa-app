const request = require('supertest');
const app = require('../src/app');

describe('Тестирование модуля аутентификации, безопасности и сессий', () => {
    const testEmail = `testuser_${Date.now()}@example.com`;
    const testPassword = 'Password123!';
    let accessToken = '';
    let refreshToken = '';

    test('1. Регистрация нового пользователя с валидными данными (201 Created)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Тестовый Пользователь',
                email: testEmail,
                password: testPassword,
                role: 'executor'
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user.email).toBe(testEmail);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
    });

    test('2. Попытка повторной регистрации с тем же email вызывает конфликт (409 Conflict)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Дубликат',
                email: testEmail,
                password: testPassword,
                role: 'executor'
            });

        expect(res.status).toBe(409);
        expect(res.header['content-type']).toMatch(/application\/problem\+json/);
        expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    test('3. Валидация сложности пароля отклоняет слабый пароль (422 Unprocessable Entity)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Слабый пароль',
                email: `weak_${Date.now()}@example.com`,
                password: '123',
                role: 'executor'
            });

        expect(res.status).toBe(422);
        expect(res.body.errors).toBeDefined();
    });

    test('4. Успешный вход в систему и получение временного ключа JWT (200 OK)', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: testEmail,
                password: testPassword
            });

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        accessToken = res.body.data.accessToken;
        refreshToken = res.body.data.refreshToken;
        expect(res.body.data.session.sessionId).toBeDefined();
    });

    test('5. Доступ к защищенному маршруту с временным ключом (200 OK)', async () => {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe(testEmail);
    });

    test('6. Отказ в доступе без токена (401 Unauthorized)', async () => {
        const res = await request(app)
            .get('/api/auth/me');

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_MISSING');
    });

    test('7. Обновление временного ключа доступа через Refresh Token (200 OK)', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        expect(res.body.data.refreshToken).not.toBe(refreshToken); // Ротация токена!

        refreshToken = res.body.data.refreshToken;
        accessToken = res.body.data.accessToken;
    });

    test('8. Контроль активных подключений: просмотр сессий текущего пользователя', async () => {
        const res = await request(app)
            .get('/api/auth/sessions')
            .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    test('9. Восстановление доступа через email (генерация одноразового токена)', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: testEmail });

        expect(res.status).toBe(200);
        expect(res.body.debugToken).toBeDefined();

        const resetToken = res.body.debugToken;
        const newPassword = 'NewSecretPassword2026!';

        // Завершение сброса пароля
        const resetRes = await request(app)
            .post('/api/auth/reset-password')
            .send({ token: resetToken, newPassword });

        expect(resetRes.status).toBe(200);

        // Проверяем, что вход со старым паролем больше не работает
        const oldLogin = await request(app)
            .post('/api/auth/login')
            .send({ email: testEmail, password: testPassword });
        expect(oldLogin.status).toBe(401);

        // Вход с новым паролем работает
        const newLogin = await request(app)
            .post('/api/auth/login')
            .send({ email: testEmail, password: newPassword });
        expect(newLogin.status).toBe(200);
    });

    test('10. Защита от подбора паролей (Brute-Force Lockout): блокировка после 5 неудачных попыток (429)', async () => {
        const bruteEmail = `brute_${Date.now()}@example.com`;
        // Регистрируем жертву
        await request(app).post('/api/auth/register').send({
            name: 'Жертва брутфорса',
            email: bruteEmail,
            password: 'TargetPassword1!',
            role: 'executor'
        });

        // 5 неверных попыток подряд
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/auth/login').send({
                email: bruteEmail,
                password: 'WrongPassword!'
            });
        }

        // 6-я попытка должна быть отклонена с HTTP 429 Too Many Requests
        const lockedRes = await request(app).post('/api/auth/login').send({
            email: bruteEmail,
            password: 'WrongPassword!'
        });

        expect(lockedRes.status).toBe(429);
        expect(lockedRes.header['retry-after']).toBeDefined();
        expect(lockedRes.body.code).toMatch(/TOO_MANY_ATTEMPTS|ACCOUNT_LOCKED/);
    });
});
