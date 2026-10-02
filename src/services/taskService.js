const fs = require('fs');
const path = require('path');
const { db, formatTask } = require('../db');
const config = require('../config');
const ApiError = require('../errors/ApiError');
const logger = require('../logger');
const { fixOriginalName } = require('../utils/fileUtils');

class TaskService {
    /**
     * Получение списка задач с фильтрацией и поиском
     */
    static getTasks({ status, search, roleFilter }, currentUser) {
        let query = `
            SELECT t.*,
                   u_creator.name as creator_name, u_creator.email as creator_email,
                   u_exec.name as executor_name, u_exec.email as executor_email,
                   u_rev.name as reviewer_name, u_rev.email as reviewer_email
            FROM tasks t
            LEFT JOIN users u_creator ON t.creator_id = u_creator.id
            LEFT JOIN users u_exec ON t.executor_id = u_exec.id
            LEFT JOIN users u_rev ON t.reviewer_id = u_rev.id
        `;

        const conditions = [];
        const params = [];

        // Фильтр по статусу
        if (status && status !== 'all') {
            const validStatuses = Object.values(config.TASK_STATUSES);
            if (!validStatuses.includes(status)) {
                throw ApiError.badRequest(`Некорректный статус фильтра '${status}'`, 'INVALID_FILTER_STATUS');
            }
            conditions.push('t.status = ?');
            params.push(status);
        }

        // Поиск по заголовку или описанию
        if (search && search.trim()) {
            conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
            const s = `%${search.trim()}%`;
            params.push(s, s);
        }

        // Ролевая фильтрация: исполнитель может захотеть видеть только свои задачи
        if (roleFilter === 'my') {
            if (currentUser.role === config.ROLES.EXECUTOR) {
                conditions.push('(t.executor_id = ? OR t.executor_id IS NULL)');
                params.push(currentUser.id);
            } else if (currentUser.role === config.ROLES.REVIEWER) {
                conditions.push('(t.reviewer_id = ? OR t.reviewer_id IS NULL)');
                params.push(currentUser.id);
            } else if (currentUser.role === config.ROLES.MANAGER) {
                conditions.push('t.creator_id = ?');
                params.push(currentUser.id);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY t.id DESC';

        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map(formatTask);
    }

    /**
     * Получение задачи по ID
     */
    static getTaskById(taskId) {
        const id = Number(taskId);
        if (isNaN(id) || id <= 0) {
            throw ApiError.badRequest('Идентификатор задачи должен быть положительным числом', 'INVALID_TASK_ID');
        }

        const query = `
            SELECT t.*,
                   u_creator.name as creator_name, u_creator.email as creator_email,
                   u_exec.name as executor_name, u_exec.email as executor_email,
                   u_rev.name as reviewer_name, u_rev.email as reviewer_email
            FROM tasks t
            LEFT JOIN users u_creator ON t.creator_id = u_creator.id
            LEFT JOIN users u_exec ON t.executor_id = u_exec.id
            LEFT JOIN users u_rev ON t.reviewer_id = u_rev.id
            WHERE t.id = ?
        `;

        const row = db.prepare(query).get(id);
        if (!row) {
            throw ApiError.notFound(`Задача с ID ${id} не найдена`, 'TASK_NOT_FOUND');
        }

        return formatTask(row);
    }

    /**
     * Валидация ролей исполнителя (только executor) и проверяющего (только reviewer)
     */
    static validateAssignees(executorIdRaw, reviewerIdRaw, errors) {
        let executorId = null;
        if (executorIdRaw !== undefined && executorIdRaw !== null && executorIdRaw !== '') {
            executorId = Number(executorIdRaw);
            if (isNaN(executorId)) {
                errors.push({ field: 'executorId', message: 'Некорректный идентификатор исполнителя' });
            } else {
                const execUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(executorId);
                if (!execUser) {
                    errors.push({ field: 'executorId', message: 'Назначенный исполнитель не найден в системе' });
                } else if (execUser.role !== config.ROLES.EXECUTOR) {
                    errors.push({
                        field: 'executorId',
                        message: `Исполнителем может быть назначен только пользователь с ролью "Исполнитель". Роль пользователя ${execUser.name}: "${execUser.role}"`
                    });
                }
            }
        }

        let reviewerId = null;
        if (reviewerIdRaw !== undefined && reviewerIdRaw !== null && reviewerIdRaw !== '') {
            reviewerId = Number(reviewerIdRaw);
            if (isNaN(reviewerId)) {
                errors.push({ field: 'reviewerId', message: 'Некорректный идентификатор проверяющего' });
            } else {
                const revUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(reviewerId);
                if (!revUser) {
                    errors.push({ field: 'reviewerId', message: 'Назначенный проверяющий не найден в системе' });
                } else if (revUser.role !== config.ROLES.REVIEWER) {
                    errors.push({
                        field: 'reviewerId',
                        message: `Проверяющим может быть назначен только пользователь с ролью "Проверяющий". Роль пользователя ${revUser.name}: "${revUser.role}"`
                    });
                }
            }
        }

        return { executorId, reviewerId };
    }

    /**
     * Создание новой задачи (доступно руководителю)
     */
    static createTask(data, file, currentUser) {
        // RBAC: создавать задачи имеет право руководитель (manager)
        if (currentUser.role !== config.ROLES.MANAGER) {
            if (file) this.cleanupFile(file.filename);
            throw ApiError.forbidden('Создавать задачи может только пользователь с ролью Руководитель', 'FORBIDDEN_ROLE');
        }

        const errors = [];
        if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
            errors.push({ field: 'title', message: 'Название задачи обязательно для заполнения' });
        } else if (data.title.trim().length > 255) {
            errors.push({ field: 'title', message: 'Длина названия не должна превышать 255 символов' });
        }

        const { executorId, reviewerId } = this.validateAssignees(data.executorId, data.reviewerId, errors);

        if (errors.length > 0) {
            if (file) this.cleanupFile(file.filename);
            throw ApiError.unprocessableEntity('Ошибка валидации данных задачи', errors);
        }

        const initialStatus = data.status || config.TASK_STATUSES.PENDING;

        const stmt = db.prepare(`
            INSERT INTO tasks (title, description, due_date, status, creator_id, executor_id, reviewer_id, attachment_filename, attachment_original_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            data.title.trim(),
            data.description ? data.description.trim() : '',
            data.dueDate || null,
            initialStatus,
            currentUser.id,
            executorId,
            reviewerId,
            file ? file.filename : null,
            file ? fixOriginalName(file.originalname) : null
        );

        logger.audit('TASK_CREATED', {
            user: currentUser,
            details: { taskId: result.lastInsertRowid, title: data.title.trim() }
        });

        return this.getTaskById(result.lastInsertRowid);
    }

    /**
     * Полное обновление задачи (PUT /api/tasks/:id)
     */
    static updateTask(taskId, data, file, currentUser) {
        const existingTask = this.getTaskById(taskId);

        // RBAC: Полное изменение доступно руководителю
        if (currentUser.role !== config.ROLES.MANAGER) {
            if (file) this.cleanupFile(file.filename);
            throw ApiError.forbidden('Полное редактирование задачи доступно только Руководителю', 'FORBIDDEN_ROLE');
        }

        const errors = [];
        if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
            errors.push({ field: 'title', message: 'Название задачи обязательно для заполнения' });
        }

        const candidateExec = data.executorId !== undefined ? data.executorId : existingTask.executor?.id;
        const candidateRev = data.reviewerId !== undefined ? data.reviewerId : existingTask.reviewer?.id;
        const { executorId, reviewerId } = this.validateAssignees(candidateExec, candidateRev, errors);

        if (errors.length > 0) {
            if (file) this.cleanupFile(file.filename);
            throw ApiError.unprocessableEntity('Ошибка валидации данных задачи', errors);
        }

        let attachmentFilename = existingTask.attachment ? existingTask.attachment.filename : null;
        let attachmentOriginalName = existingTask.attachment ? existingTask.attachment.originalName : null;

        if (data.removeAttachment === 'true' || data.removeAttachment === true) {
            if (attachmentFilename) {
                this.cleanupFile(attachmentFilename);
                attachmentFilename = null;
                attachmentOriginalName = null;
            }
        }

        if (file) {
            if (attachmentFilename) {
                this.cleanupFile(attachmentFilename);
            }
            attachmentFilename = file.filename;
            attachmentOriginalName = fixOriginalName(file.originalname);
        }

        db.prepare(`
            UPDATE tasks
            SET title = ?, description = ?, due_date = ?, status = ?, executor_id = ?, reviewer_id = ?,
                attachment_filename = ?, attachment_original_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            data.title.trim(),
            data.description !== undefined ? data.description.trim() : existingTask.description,
            data.dueDate !== undefined ? data.dueDate : existingTask.dueDate,
            data.status || existingTask.status,
            executorId,
            reviewerId,
            attachmentFilename,
            attachmentOriginalName,
            existingTask.id
        );

        logger.audit('TASK_UPDATED', {
            user: currentUser,
            details: { taskId: existingTask.id, title: data.title.trim() }
        });

        return this.getTaskById(existingTask.id);
    }

    /**
     * Частичное обновление задачи / смена статуса (PATCH /api/tasks/:id)
     * с контролем переходов согласно ролевой модели (Руководитель, Исполнитель, Проверяющий)
     */
    static patchTask(taskId, data, file, currentUser) {
        const task = this.getTaskById(taskId);
        const { role } = currentUser;
        const newStatus = data.status;
        const reviewComment = data.reviewComment !== undefined ? data.reviewComment : task.reviewComment;
        const reportComment = data.reportComment !== undefined ? data.reportComment.trim() : task.reportComment;

        let attachmentFilename = task.attachment ? task.attachment.filename : null;
        let attachmentOriginalName = task.attachment ? task.attachment.originalName : null;

        let reportFilename = task.reportAttachment ? task.reportAttachment.filename : null;
        let reportOriginalName = task.reportAttachment ? task.reportAttachment.originalName : null;

        if (file) {
            const isReportUpload = role === config.ROLES.EXECUTOR || 
                                   newStatus === config.TASK_STATUSES.IN_REVIEW || 
                                   file.fieldname === 'reportFile';

            if (isReportUpload) {
                if (reportFilename) this.cleanupFile(reportFilename);
                reportFilename = file.filename;
                reportOriginalName = fixOriginalName(file.originalname);
            } else {
                if (attachmentFilename) this.cleanupFile(attachmentFilename);
                attachmentFilename = file.filename;
                attachmentOriginalName = fixOriginalName(file.originalname);
            }
        }

        if (newStatus && newStatus !== task.status) {
            // Проверка бизнес-правил ролей
            if (role === config.ROLES.EXECUTOR) {
                // Исполнитель может:
                // pending -> in_progress (взять в работу)
                // in_progress -> in_review (отправить на проверку)
                // rejected -> in_progress (взять на исправление)
                const allowedTransitions = [
                    { from: config.TASK_STATUSES.PENDING, to: config.TASK_STATUSES.IN_PROGRESS },
                    { from: config.TASK_STATUSES.IN_PROGRESS, to: config.TASK_STATUSES.IN_REVIEW },
                    { from: config.TASK_STATUSES.REJECTED, to: config.TASK_STATUSES.IN_PROGRESS }
                ];

                const isAllowed = allowedTransitions.some(t => t.from === task.status && t.to === newStatus);
                if (!isAllowed) {
                    if (newStatus === config.TASK_STATUSES.COMPLETED) {
                        throw ApiError.forbidden('Исполнитель не может самостоятельно завершить задачу. Переведите в статус "На проверке" для рецензирования Проверяющим.', 'STATUS_TRANSITION_FORBIDDEN');
                    }
                    throw ApiError.forbidden(`Исполнителю запрещен переход из статуса '${task.status}' в '${newStatus}'`, 'STATUS_TRANSITION_FORBIDDEN');
                }
            } else if (role === config.ROLES.REVIEWER) {
                // Проверяющий может:
                // in_review -> completed (утвердить и принять)
                // in_review -> rejected (вернуть на доработку с замечанием)
                // in_review -> in_progress (вернуть в работу)
                const allowedTransitions = [
                    { from: config.TASK_STATUSES.IN_REVIEW, to: config.TASK_STATUSES.COMPLETED },
                    { from: config.TASK_STATUSES.IN_REVIEW, to: config.TASK_STATUSES.REJECTED },
                    { from: config.TASK_STATUSES.IN_REVIEW, to: config.TASK_STATUSES.IN_PROGRESS }
                ];

                const isAllowed = allowedTransitions.some(t => t.from === task.status && t.to === newStatus);
                if (!isAllowed) {
                    throw ApiError.forbidden(`Проверяющий может проверять задачи в статусе 'На проверке'. Переход '${task.status}' -> '${newStatus}' отклонен.`, 'STATUS_TRANSITION_FORBIDDEN');
                }

                if (newStatus === config.TASK_STATUSES.REJECTED && (!reviewComment || !reviewComment.trim())) {
                    throw ApiError.unprocessableEntity('При отклонении задачи проверяющий обязан указать комментарий с замечаниями', [
                        { field: 'reviewComment', message: 'Обязательно укажите причину возврата на доработку' }
                    ]);
                }
            }
            // Руководитель (manager) может совершать любые переходы
        }

        db.prepare(`
            UPDATE tasks
            SET status = COALESCE(?, status),
                review_comment = ?,
                report_comment = ?,
                report_filename = ?,
                report_original_name = ?,
                attachment_filename = ?,
                attachment_original_name = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            newStatus || null,
            reviewComment,
            reportComment,
            reportFilename,
            reportOriginalName,
            attachmentFilename,
            attachmentOriginalName,
            task.id
        );

        logger.audit('TASK_STATUS_CHANGED', {
            user: currentUser,
            details: { 
                taskId: task.id, 
                fromStatus: task.status, 
                toStatus: newStatus || task.status, 
                reviewComment,
                reportComment: reportComment || undefined,
                hasReportFile: !!reportFilename
            }
        });

        return this.getTaskById(task.id);
    }

    /**
     * Удаление задачи (доступно только руководителю)
     */
    static deleteTask(taskId, currentUser) {
        const task = this.getTaskById(taskId);

        // RBAC: Удалять задачи разрешено только руководителю!
        if (currentUser.role !== config.ROLES.MANAGER) {
            throw ApiError.forbidden('Удаление задач разрешено исключительно пользователям с ролью Руководитель', 'FORBIDDEN_ROLE');
        }

        if (task.attachment && task.attachment.filename) {
            this.cleanupFile(task.attachment.filename);
        }
        if (task.reportAttachment && task.reportAttachment.filename) {
            this.cleanupFile(task.reportAttachment.filename);
        }

        db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);

        logger.audit('TASK_DELETED', {
            user: currentUser,
            details: { taskId: task.id, title: task.title }
        });

        return { success: true, deletedId: task.id };
    }

    /**
     * Безопасное удаление файла с диска
     */
    static cleanupFile(filename) {
        if (!filename) return;
        const filePath = path.join(config.UPLOADS_DIR, filename);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                logger.error(`Ошибка удаления файла ${filePath}: ${e.message}`);
            }
        }
    }
}

module.exports = TaskService;
