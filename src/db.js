const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const config = require('./config');

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

function seedDatabase() {
    const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?)
    `);

    const managerHash = bcrypt.hashSync('Manager123!', config.BCRYPT_SALT_ROUNDS);
    const executorHash = bcrypt.hashSync('Executor123!', config.BCRYPT_SALT_ROUNDS);
    const reviewerHash = bcrypt.hashSync('Reviewer123!', config.BCRYPT_SALT_ROUNDS);

    // 1. Создаем или сохраняем 3 роли для лабораторной работы
    insertUser.run('Дмитрий Ковалев', 'manager@example.com', managerHash, config.ROLES.MANAGER);
    insertUser.run('Максим Морозов', 'executor@example.com', executorHash, config.ROLES.EXECUTOR);
    insertUser.run('Анна Новикова', 'reviewer@example.com', reviewerHash, config.ROLES.REVIEWER);

    // Реальный пользователь для демонстрации восстановления через личный email
    const yana = db.prepare("SELECT * FROM users WHERE email = 'arikhartmen75@gmail.com'").get();
    if (!yana) {
        insertUser.run('Яна Алексейчик', 'arikhartmen75@gmail.com', managerHash, config.ROLES.MANAGER);
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
 */
function formatTask(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        dueDate: row.due_date || '',
        status: row.status,
        creator: row.creator_name ? { id: row.creator_id, name: row.creator_name, email: row.creator_email } : { id: row.creator_id },
        executor: row.executor_name ? { id: row.executor_id, name: row.executor_name, email: row.executor_email } : (row.executor_id ? { id: row.executor_id } : null),
        reviewer: row.reviewer_name ? { id: row.reviewer_id, name: row.reviewer_name, email: row.reviewer_email } : (row.reviewer_id ? { id: row.reviewer_id } : null),
        reviewComment: row.review_comment || '',
        attachment: row.attachment_filename ? {
            filename: row.attachment_filename,
            originalName: row.attachment_original_name,
            url: `/uploads/${row.attachment_filename}`,
            downloadUrl: `/api/tasks/${row.id}/attachment`
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
