const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TaskService = require('../services/taskService');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const config = require('../config');
const ApiError = require('../errors/ApiError');

// Создаем папку загрузок при необходимости
if (!fs.existsSync(config.UPLOADS_DIR)) {
    fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

// Настройка хранилища загружаемых файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 15 * 1024 * 1024 // 15 МБ
    }
});

// Все маршруты задач требуют аутентификации по временному ключу JWT
router.use(authenticateToken);

/**
 * 1. GET /api/tasks - Получение списка задач
 * Доступно всем аутентифицированным ролям
 */
router.get('/', (req, res, next) => {
    try {
        const { status, search, roleFilter } = req.query;
        const tasks = TaskService.getTasks({ status, search, roleFilter }, req.user);

        res.status(200).json({
            success: true,
            count: tasks.length,
            data: tasks
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 2. GET /api/tasks/:id - Получение одной задачи по ID
 */
router.get('/:id', (req, res, next) => {
    try {
        const task = TaskService.getTaskById(req.params.id);
        res.status(200).json({
            success: true,
            data: task
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 3. POST /api/tasks - Создание новой задачи
 * RBAC: Разрешено только роли "Руководитель" (manager)
 */
router.post('/', requireRoles(config.ROLES.MANAGER), upload.single('attachment'), (req, res, next) => {
    try {
        const newTask = TaskService.createTask(req.body, req.file, req.user);

        // Согласно семантике HTTP 201 Created выставляем заголовок Location
        res.setHeader('Location', `/api/tasks/${newTask.id}`);
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана',
            data: newTask
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 4. PUT /api/tasks/:id - Полное обновление задачи
 * RBAC: Разрешено только роли "Руководитель" (manager)
 */
router.put('/:id', requireRoles(config.ROLES.MANAGER), upload.single('attachment'), (req, res, next) => {
    try {
        const updatedTask = TaskService.updateTask(req.params.id, req.body, req.file, req.user);
        res.status(200).json({
            success: true,
            message: 'Задача успешно обновлена',
            data: updatedTask
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 5. PATCH /api/tasks/:id - Частичное обновление / изменение статуса задачи
 * RBAC: Доступно всем 3 ролям, логика разрешенных переходов проверяется в TaskService.patchTask
 */
router.patch('/:id', upload.single('attachment'), (req, res, next) => {
    try {
        const patchedTask = TaskService.patchTask(req.params.id, req.body, req.file, req.user);
        res.status(200).json({
            success: true,
            message: 'Статус задачи успешно обновлен',
            data: patchedTask
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 6. DELETE /api/tasks/:id - Удаление задачи
 * RBAC: Строго ограничено ролью "Руководитель" (manager)
 */
router.delete('/:id', requireRoles(config.ROLES.MANAGER), (req, res, next) => {
    try {
        const result = TaskService.deleteTask(req.params.id, req.user);
        res.status(200).json({
            success: true,
            message: `Задача #${result.deletedId} успешно удалена`,
            deletedId: result.deletedId
        });
    } catch (err) {
        next(err);
    }
});

/**
 * 7. GET /api/tasks/:id/attachment - Скачивание прикрепленного файла
 */
router.get('/:id/attachment', (req, res, next) => {
    try {
        const task = TaskService.getTaskById(req.params.id);

        if (!task.attachment || !task.attachment.filename) {
            throw ApiError.notFound('Прикрепленный файл у этой задачи отсутствует', 'ATTACHMENT_NOT_FOUND');
        }

        const filePath = path.join(config.UPLOADS_DIR, task.attachment.filename);
        if (!fs.existsSync(filePath)) {
            throw ApiError.notFound('Файл отсутствует на диске сервера', 'FILE_MISSING');
        }

        res.download(filePath, task.attachment.originalName || task.attachment.filename);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
