const request = require('supertest');
const app = require('../src/app');

const { db } = require('../src/db');

describe('Тестирование ролевой модели доступа (RBAC): Руководитель, Исполнитель, Проверяющий', () => {
    let managerToken = '';
    let executorToken = '';
    let reviewerToken = '';
    let testTaskId = null;

    beforeAll(async () => {
        db.prepare('UPDATE users SET is_locked = 0, locked_until = NULL').run();
        db.prepare('DELETE FROM login_attempts').run();

        // Вход под 3 предустановленными ролями
        const mRes = await request(app).post('/api/auth/login').send({
            email: 'manager@example.com',
            password: 'Manager123!'
        });
        managerToken = mRes.body.data.accessToken;

        const eRes = await request(app).post('/api/auth/login').send({
            email: 'executor@example.com',
            password: 'Executor123!'
        });
        executorToken = eRes.body.data.accessToken;

        const rRes = await request(app).post('/api/auth/login').send({
            email: 'reviewer@example.com',
            password: 'Reviewer123!'
        });
        reviewerToken = rRes.body.data.accessToken;
    });

    test('1. Руководитель имеет право создавать задачу (201 Created)', async () => {
        const res = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'RBAC Тестовая задача',
                description: 'Проверка прав 3 ролей',
                dueDate: '2026-12-31',
                status: 'pending'
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.header['location']).toBeDefined();
        testTaskId = res.body.data.id;
    });

    test('2. Исполнитель НЕ имеет права создавать задачу (403 Forbidden)', async () => {
        const res = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${executorToken}`)
            .send({
                title: 'Попытка создания от Исполнителя'
            });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    test('3. Проверяющий НЕ имеет права создавать задачу (403 Forbidden)', async () => {
        const res = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${reviewerToken}`)
            .send({
                title: 'Попытка создания от Проверяющего'
            });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    test('4. Исполнитель может взять задачу в работу (pending -> in_progress) (200 OK)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({
                status: 'in_progress'
            });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('in_progress');
    });

    test('5. Исполнитель НЕ может самостоятельно перевести задачу в completed (403 Forbidden)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({
                status: 'completed'
            });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('STATUS_TRANSITION_FORBIDDEN');
    });

    test('6. Исполнитель может передать задачу на проверку (in_progress -> in_review) (200 OK)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({
                status: 'in_review'
            });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('in_review');
    });

    test('7. Проверяющий не может отклонить задачу без комментария с замечаниями (422 Unprocessable Entity)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${reviewerToken}`)
            .send({
                status: 'rejected',
                reviewComment: '' // Пустой комментарий запрещен
            });

        expect(res.status).toBe(422);
        expect(res.body.errors).toBeDefined();
    });

    test('8. Проверяющий может вернуть задачу на доработку с замечанием (200 OK)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${reviewerToken}`)
            .send({
                status: 'rejected',
                reviewComment: 'Исправьте оформление отчета'
            });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('rejected');
        expect(res.body.data.reviewComment).toBe('Исправьте оформление отчета');
    });

    test('9. Исполнитель возвращает задачу в работу и повторно сдает на проверку (200 OK)', async () => {
        await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({ status: 'in_progress' });

        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({ status: 'in_review' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('in_review');
    });

    test('10. Проверяющий утверждает задачу (in_review -> completed) (200 OK)', async () => {
        const res = await request(app)
            .patch(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${reviewerToken}`)
            .send({
                status: 'completed',
                reviewComment: 'Замечания устранены, принято.'
            });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('completed');
    });

    test('11. Исполнитель и Проверяющий НЕ имеют права удалять задачу (403 Forbidden)', async () => {
        const resExec = await request(app)
            .delete(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${executorToken}`);
        expect(resExec.status).toBe(403);

        const resRev = await request(app)
            .delete(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${reviewerToken}`);
        expect(resRev.status).toBe(403);
    });

    test('12. Руководитель имеет право удалить задачу (200 OK)', async () => {
        const res = await request(app)
            .delete(`/api/tasks/${testTaskId}`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.deletedId).toBe(testTaskId);
    });

    test('13. Просмотр журнала аудита: Руководитель (200 OK), Исполнитель (403 Forbidden)', async () => {
        const resExec = await request(app)
            .get('/api/logs/audit')
            .set('Authorization', `Bearer ${executorToken}`);
        expect(resExec.status).toBe(403);

        const resMgr = await request(app)
            .get('/api/logs/audit')
            .set('Authorization', `Bearer ${managerToken}`);
        expect(resMgr.status).toBe(200);
        expect(Array.isArray(resMgr.body.data)).toBe(true);
    });
});
