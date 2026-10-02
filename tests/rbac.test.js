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
            email: 'kovalev.dmitry@bsuir.by',
            password: 'Kovalev#Mgr2026!Sec'
        });
        managerToken = mRes.body.data.accessToken;

        const eRes = await request(app).post('/api/auth/login').send({
            email: 'morozov.maxim@bsuir.by',
            password: 'Morozov#Dev2026!Sec'
        });
        executorToken = eRes.body.data.accessToken;

        const rRes = await request(app).post('/api/auth/login').send({
            email: 'novikova.anna@bsuir.by',
            password: 'Novikova#Rev2026!Sec'
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

    test('14. Валидация ролей при назначении: исполнитель должен иметь роль executor, проверяющий — reviewer (422 Unprocessable Entity)', async () => {
        const mgrUser = db.prepare("SELECT id FROM users WHERE email = 'kovalev.dmitry@bsuir.by'").get();
        const execUser = db.prepare("SELECT id FROM users WHERE email = 'morozov.maxim@bsuir.by'").get();
        const revUser = db.prepare("SELECT id FROM users WHERE email = 'novikova.anna@bsuir.by'").get();

        // Попытка назначить руководителя или проверяющего в качестве исполнителя
        const resInvalidExec = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'Тест некорректного исполнителя',
                executorId: revUser.id
            });

        expect(resInvalidExec.status).toBe(422);
        expect(resInvalidExec.body.errors.some(e => e.field === 'executorId')).toBe(true);

        // Попытка назначить исполнителя в качестве проверяющего
        const resInvalidRev = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'Тест некорректного проверяющего',
                reviewerId: execUser.id
            });

        expect(resInvalidRev.status).toBe(422);
        expect(resInvalidRev.body.errors.some(e => e.field === 'reviewerId')).toBe(true);

        // Попытка назначить руководителя в качестве проверяющего
        const resInvalidRevMgr = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'Тест назначения руководителя проверяющим',
                reviewerId: mgrUser.id
            });

        expect(resInvalidRevMgr.status).toBe(422);
        expect(resInvalidRevMgr.body.errors.some(e => e.field === 'reviewerId')).toBe(true);

        // Попытка назначить корректные роли проходит успешно (201 Created)
        const resValid = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'Тест корректных назначений',
                executorId: execUser.id,
                reviewerId: revUser.id
            });

        expect(resValid.status).toBe(201);
        expect(resValid.body.data.executor.id).toBe(execUser.id);
        expect(resValid.body.data.reviewer.id).toBe(revUser.id);

        // Очистим созданную задачу
        await request(app)
            .delete(`/api/tasks/${resValid.body.data.id}`)
            .set('Authorization', `Bearer ${managerToken}`);
    });

    test('15. Исполнитель сдает работу на проверку с прикреплением отчета (архив ZIP) и комментария (200 OK)', async () => {
        const execUser = db.prepare("SELECT id FROM users WHERE email = 'morozov.maxim@bsuir.by'").get();
        const revUser = db.prepare("SELECT id FROM users WHERE email = 'novikova.anna@bsuir.by'").get();

        // 1. Руководитель создает задачу
        const taskRes = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                title: 'Разработка модуля с отчетом',
                executorId: execUser.id,
                reviewerId: revUser.id,
                status: 'pending'
            });
        const taskId = taskRes.body.data.id;

        // 2. Исполнитель берет задачу в работу
        await request(app)
            .patch(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .send({ status: 'in_progress' });

        // 3. Исполнитель сдает работу на проверку с файлом отчета (ZIP) и комментарием
        const fakeZipBuffer = Buffer.from('PK\x03\x04MockZipContentForLab3Report');
        const submitRes = await request(app)
            .patch(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .field('status', 'in_review')
            .field('reportComment', 'Лабораторная работа выполнена, исходники и документация в архиве')
            .attach('reportFile', fakeZipBuffer, 'lab3_solution_report.zip');

        expect(submitRes.status).toBe(200);
        expect(submitRes.body.data.status).toBe('in_review');
        expect(submitRes.body.data.reportComment).toBe('Лабораторная работа выполнена, исходники и документация в архиве');
        expect(submitRes.body.data.reportAttachment).toBeDefined();
        expect(submitRes.body.data.reportAttachment.originalName).toBe('lab3_solution_report.zip');

        // 4. Проверяющий или исполнитель может скачать прикрепленный отчет
        const downloadRes = await request(app)
            .get(`/api/tasks/${taskId}/report`)
            .set('Authorization', `Bearer ${reviewerToken}`);

        expect(downloadRes.status).toBe(200);
        expect(downloadRes.header['content-disposition']).toContain('lab3_solution_report.zip');

        // 5. Очистим тестовую задачу
        await request(app)
            .delete(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${managerToken}`);
    });

    test('16. Корректная обработка кириллических имен файлов (русские буквы) без искажений (mojibake)', async () => {
        const execUser = db.prepare("SELECT id FROM users WHERE email = 'morozov.maxim@bsuir.by'").get();
        const revUser = db.prepare("SELECT id FROM users WHERE email = 'novikova.anna@bsuir.by'").get();

        // 1. Руководитель создает задачу с вложением ТЗ на русском языке
        const fakePdfBuffer = Buffer.from('%PDF-1.4 MockPdfData');
        const taskRes = await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${managerToken}`)
            .field('title', 'Задача с кириллическим вложением')
            .field('executorId', execUser.id)
            .field('reviewerId', revUser.id)
            .attach('attachment', fakePdfBuffer, 'ТЗ_Техническое_Задание_ЛР3.pdf');

        expect(taskRes.status).toBe(201);
        expect(taskRes.body.data.attachment).toBeDefined();
        expect(taskRes.body.data.attachment.originalName).toBe('ТЗ_Техническое_Задание_ЛР3.pdf');

        const taskId = taskRes.body.data.id;

        // 2. Исполнитель сдает отчет также с русским именем файла архива
        const reportRes = await request(app)
            .patch(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .field('status', 'in_progress');
        expect(reportRes.status).toBe(200);

        const fakeZipBuffer = Buffer.from('PK\x03\x04MockZipContent');
        const submitRes = await request(app)
            .patch(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${executorToken}`)
            .field('status', 'in_review')
            .field('reportComment', 'Отчет и исходные коды прикреплены')
            .attach('reportFile', fakeZipBuffer, 'Отчет_по_Лабораторной_Работе_3.zip');

        expect(submitRes.status).toBe(200);
        expect(submitRes.body.data.reportAttachment).toBeDefined();
        expect(submitRes.body.data.reportAttachment.originalName).toBe('Отчет_по_Лабораторной_Работе_3.zip');

        // 3. Проверка скачивания отчета - имя корректно закодировано по RFC 5987 / UTF-8
        const downloadRes = await request(app)
            .get(`/api/tasks/${taskId}/report`)
            .set('Authorization', `Bearer ${reviewerToken}`);

        expect(downloadRes.status).toBe(200);
        const disposition = downloadRes.header['content-disposition'];
        expect(disposition).toContain(encodeURIComponent('Отчет_по_Лабораторной_Работе_3.zip'));

        // 4. Очистка
        await request(app)
            .delete(`/api/tasks/${taskId}`)
            .set('Authorization', `Bearer ${managerToken}`);
    });
});



