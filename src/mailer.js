const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

async function getTransporter() {
    if (transporter) return transporter;

    if (process.env.NODE_ENV === 'test') {
        transporter = nodemailer.createTransport({
            jsonTransport: true
        });
        return transporter;
    }

    if (process.env.SMTP_HOST) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    } else {
        // Для учебного проекта и локального тестирования используем тестовый почтовый ящик Ethereal или виртуальный транспорт
        try {
            const testAccount = await nodemailer.createTestAccount();
            transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                }
            });
            logger.info('Инициализирован тестовый почтовый транспорт Ethereal');
        } catch (e) {
            // Фолбэк на виртуальный JSON транспорт при отсутствии интернет-соединения
            transporter = nodemailer.createTransport({
                jsonTransport: true
            });
            logger.info('Инициализирован локальный JSON-почтовый транспорт');
        }
    }

    return transporter;
}

/**
 * Отправка письма для сброса пароля
 */
async function sendPasswordResetEmail(email, resetToken, resetUrl) {
    try {
        const mail = await getTransporter();

        const message = {
            from: '"Система управления задачами (СПП ЛР3)" <security@bsuir.by>',
            to: email,
            subject: 'Восстановление доступа к аккаунту',
            text: 'Здравствуйте! Вы запросили восстановление доступа.\n\n' +
                  `Ваш одноразовый токен: ${resetToken}\n\n` +
                  `Или перейдите по ссылке: ${resetUrl}\n\n` +
                  'Ссылка действительна в течение 15 минут. Если вы не запрашивали сброс, проигнорируйте это письмо.',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #2563eb;">Восстановление доступа к системе</h2>
                    <p>Здравствуйте!</p>
                    <p>Был получен запрос на сброс пароля для вашей учетной записи в Системе задач СПП (ЛР3).</p>
                    <div style="background-color: #f1f5f9; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center;">
                        <p style="margin: 0; font-size: 14px; color: #64748b;">Одноразовый код подтверждения:</p>
                        <p style="margin: 8px 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #1e293b;">${resetToken}</p>
                    </div>
                    <p style="text-align: center; margin: 25px 0;">
                        <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                            Перейти к смене пароля
                        </a>
                    </p>
                    <p style="font-size: 12px; color: #94a3b8;">Срок действия токена — 15 минут. Если вы не запрашивали сброс пароля, немедленно проверьте активные сессии в профиле.</p>
                </div>
            `
        };

        const info = await mail.sendMail(message);
        let previewUrl = null;
        if (nodemailer.getTestMessageUrl) {
            previewUrl = nodemailer.getTestMessageUrl(info);
        }

        logger.info(`[EMAIL] Письмо восстановления пароля успешно отправлено на ${email}`, {
            messageId: info.messageId,
            previewUrl: previewUrl || undefined,
            resetToken
        });

        return {
            success: true,
            previewUrl,
            messageId: info.messageId
        };
    } catch (err) {
        logger.error(`[EMAIL ERROR] Ошибка отправки письма на ${email}: ${err.message}`, { stack: err.stack });
        throw err;
    }
}

module.exports = {
    sendPasswordResetEmail
};
