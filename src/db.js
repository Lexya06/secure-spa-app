const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { fixOriginalName } = require('./utils/fileUtils');

// Убеждаемся в наличии папки для БД
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Создание структуры таблиц
db.exec(`
    -- Таблица пользователей с 3 ролями
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('manager', 'executor', 'reviewer')),
        is_locked INTEGER DEFAULT 0,
        locked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Таблица задач с ролевым контролем и жизненным циклом
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'in_review', 'completed', 'rejected')),
        creator_id INTEGER NOT NULL REFERENCES users(id),
        executor_id INTEGER REFERENCES users(id),
        reviewer_id INTEGER REFERENCES users(id),
        review_comment TEXT,
        attachment_filename TEXT,
        attachment_original_name TEXT,
        report_filename TEXT,
        report_original_name TEXT,
        report_comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Таблица активных подключений и сессий (Контроль активных подключений)
    CREATE TABLE IF NOT EXISTS active_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        device_name TEXT,
        is_revoked INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
    );

    -- Таблица попыток входа (Защита от подбора учетных данных)
    CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE,
        attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        success INTEGER DEFAULT 0
    );

    -- Таблица заявок на восстановление пароля через email
    CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Миграция схемы для добавления полей отчета исполнителя (если база уже существовала)
const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
if (!taskCols.includes('report_filename')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN report_filename TEXT').run();
}
if (!taskCols.includes('report_original_name')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN report_original_name TEXT').run();
}
if (!taskCols.includes('report_comment')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN report_comment TEXT').run();
}

// Автоматическое исправление кодировки имен существующих вложений в БД (кириллица / CP1252)
try {
    const existingTasks = db.prepare('SELECT id, attachment_original_name, report_original_name FROM tasks WHERE attachment_original_name IS NOT NULL OR report_original_name IS NOT NULL').all();
    const updateStmt = db.prepare('UPDATE tasks SET attachment_original_name = ?, report_original_name = ? WHERE id = ?');
    for (const t of existingTasks) {
        const fixedAttach = fixOriginalName(t.attachment_original_name);
        const fixedReport = fixOriginalName(t.report_original_name);
        if (fixedAttach !== t.attachment_original_name || fixedReport !== t.report_original_name) {
            updateStmt.run(fixedAttach, fixedReport, t.id);
        }
    }
} catch {
    // Игнорируем ошибки авто-исправления при первой инициализации
}

function seedDatabase() {
    const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?)
    `);

    // Новые надежные и уникальные пароли, исключающие ложное срабатывание о проверке утечек данных (Chrome Data Breach Warning)
    const managerPass = 'Kovalev#Mgr2026!Sec';
    const executorPass = 'Morozov#Dev2026!Sec';
    const reviewerPass = 'Novikova#Rev2026!Sec';
    const yanaPass = 'Alexeychik#2026!Sec';

    const managerHash = bcrypt.hashSync(managerPass, config.BCRYPT_SALT_ROUNDS);
    const executorHash = bcrypt.hashSync(executorPass, config.BCRYPT_SALT_ROUNDS);
    const reviewerHash = bcrypt.hashSync(reviewerPass, config.BCRYPT_SALT_ROUNDS);
    const yanaHash = bcrypt.hashSync(yanaPass, config.BCRYPT_SALT_ROUNDS);

    // Миграция со старых скомпрометированных логинов/паролей (если база уже существовала)
    db.prepare("UPDATE users SET email = 'kovalev.dmitry@bsuir.by', password_hash = ? WHERE email = 'manager@example.com'").run(managerHash);
    db.prepare("UPDATE users SET email = 'morozov.maxim@bsuir.by', password_hash = ? WHERE email = 'executor@example.com'").run(executorHash);
    db.prepare("UPDATE users SET email = 'novikova.anna@bsuir.by', password_hash = ? WHERE email = 'reviewer@example.com'").run(reviewerHash);

    // Обновляем хэши паролей для пользователей
    db.prepare("UPDATE users SET password_hash = ? WHERE email = 'kovalev.dmitry@bsuir.by'").run(managerHash);
    db.prepare("UPDATE users SET password_hash = ? WHERE email = 'morozov.maxim@bsuir.by'").run(executorHash);
    db.prepare("UPDATE users SET password_hash = ? WHERE email = 'novikova.anna@bsuir.by'").run(reviewerHash);

    // Снимаем блокировки учетных записей при рестарте
    db.prepare("UPDATE users SET is_locked = 0, locked_until = NULL WHERE email IN ('kovalev.dmitry@bsuir.by', 'morozov.maxim@bsuir.by', 'novikova.anna@bsuir.by', 'arikhartmen75@gmail.com')").run();

    // 1. Создаем или сохраняем 3 роли для лабораторной работы
    insertUser.run('Дмитрий Ковалев', 'kovalev.dmitry@bsuir.by', managerHash, config.ROLES.MANAGER);
    insertUser.run('Максим Морозов', 'morozov.maxim@bsuir.by', executorHash, config.ROLES.EXECUTOR);
    insertUser.run('Анна Новикова', 'novikova.anna@bsuir.by', reviewerHash, config.ROLES.REVIEWER);

    // Реальный пользователь для демонстрации восстановления через личный email
    const yana = db.prepare("SELECT * FROM users WHERE email = 'arikhartmen75@gmail.com'").get();
    if (!yana) {
        insertUser.run('Яна Алексейчик', 'arikhartmen75@gmail.com', yanaHash, config.ROLES.MANAGER);
    } else {
        db.prepare("UPDATE users SET password_hash = ? WHERE email = 'arikhartmen75@gmail.com'").run(yanaHash);
    }

    // 2. Демонстрационные задачи с назначенными исполнителями и проверяющими
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
    if (taskCount === 0) {
        const mgr = db.prepare("SELECT id FROM users WHERE role = 'manager'").get();
        const exec = db.prepare("SELECT id FROM users WHERE role = 'executor'").get();
        const rev = db.prepare("SELECT id FROM users WHERE role = 'reviewer'").get();

        const insertTask = db.prepare(`
            INSERT INTO tasks (title, description, due_date, status, creator_id, executor_id, reviewer_id, review_comment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertTask.run(
            'Реализация ролевой модели (RBAC) и JWT',
            'Настроить проверку ролей руководителя, исполнителя и проверяющего на временных ключах',
            '2026-10-15',
            config.TASK_STATUSES.IN_REVIEW,
            mgr.id,
            exec.id,
            rev.id,
            'Реализация завершена, отправлено на проверку'
        );

        insertTask.run(
            'Настройка структурированного логирования',
            'Подключить логирование Winston в формате JSON со сквозным Request ID',
            '2026-10-20',
            config.TASK_STATUSES.IN_PROGRESS,
            mgr.id,
            exec.id,
            rev.id,
            null
        );

        insertTask.run(
            'Подготовка документации и пояснительной записки',
            'Описать архитектуру решения, обработку ошибок по RFC 7807 и защиту от брутфорса',
            '2026-10-25',
            config.TASK_STATUSES.PENDING,
            mgr.id,
            exec.id,
            rev.id,
            null
        );
    }
}

seedDatabase();

/**
 * Вспомогательная функция приведения сущности задачи к публичному API
 * Не распространяет приватные адреса электронной почты других пользователей
 */
function formatTask(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        dueDate: row.due_date || '',
        status: row.status,
        creator: row.creator_name ? { id: row.creator_id, name: row.creator_name } : { id: row.creator_id },
        executor: row.executor_name ? { id: row.executor_id, name: row.executor_name } : (row.executor_id ? { id: row.executor_id } : null),
        reviewer: row.reviewer_name ? { id: row.reviewer_id, name: row.reviewer_name } : (row.reviewer_id ? { id: row.reviewer_id } : null),
        reviewComment: row.review_comment || '',
        reportComment: row.report_comment || '',
        attachment: row.attachment_filename ? {
            filename: row.attachment_filename,
            originalName: fixOriginalName(row.attachment_original_name),
            url: `/uploads/${row.attachment_filename}`,
            downloadUrl: `/api/tasks/${row.id}/attachment`
        } : null,
        reportAttachment: row.report_filename ? {
            filename: row.report_filename,
            originalName: fixOriginalName(row.report_original_name),
            url: `/uploads/${row.report_filename}`,
            downloadUrl: `/api/tasks/${row.id}/report`
        } : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

module.exports = {
    db,
    formatTask,
    seedDatabase
};
