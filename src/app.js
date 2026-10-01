const express = require('express');
const path = require('path');
const cors = require('cors');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const ApiError = require('./errors/ApiError');

const authRoutes = require('./routes/authRoutes');
const taskRoutes = require('./routes/taskRoutes');
const logRoutes = require('./routes/logRoutes');
const config = require('./config');

const app = express();

// Безопасность и CORS
app.use(cors());

// Структурированное логирование каждого запроса со сквозным RequestId
app.use(requestLogger);

// Парсинг JSON и form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача клиентских файлов SPA и загруженных вложений
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(config.UPLOADS_DIR));

// Подключение REST API маршрутов
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/logs', logRoutes);

// Обработка несуществующих маршрутов (404 Not Found по RFC 7807)
app.use((req, res, next) => {
    next(ApiError.notFound(`Запрашиваемый ресурс не найден: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
});

// Централизованный обработчик ошибок (Problem Details)
app.use(errorHandler);

module.exports = app;
