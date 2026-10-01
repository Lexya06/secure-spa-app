const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { authenticateToken, requireRoles } = require('../middleware/auth');

// Просмотр логов аудита доступен только руководителю
router.use(authenticateToken);
router.use(requireRoles(config.ROLES.MANAGER));

/**
 * GET /api/logs/audit - Получение последних структурированных логов аудита
 */
router.get('/audit', (req, res, next) => {
    try {
        const auditLogPath = path.join(config.LOGS_DIR, 'audit.log');
        if (!fs.existsSync(auditLogPath)) {
            return res.status(200).json({ success: true, count: 0, data: [] });
        }

        const lines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');
        const limit = Math.min(Number(req.query.limit) || 50, 200);

        const logs = lines
            .filter(line => line.trim().length > 0)
            .slice(-limit)
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return { raw: line };
                }
            })
            .reverse();

        res.status(200).json({
            success: true,
            count: logs.length,
            data: logs
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
