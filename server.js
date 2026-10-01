const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/logger');

const server = app.listen(config.PORT, () => {
    logger.info(`[SERVER] Защищенный REST API сервер запущен на порту ${config.PORT} (Окружение: ${config.NODE_ENV})`);
    logger.info(`[SERVER] Клиентский интерфейс SPA доступен по адресу: http://localhost:${config.PORT}`);
});

process.on('SIGTERM', () => {
    logger.info('[SERVER] Получен сигнал SIGTERM, плавное завершение работы...');
    server.close(() => {
        logger.info('[SERVER] Сервер успешно остановлен.');
        process.exit(0);
    });
});

module.exports = server;
