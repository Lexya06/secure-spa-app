const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;
const sentEmailsList = [];

/**
 * Получение локального почтового транспорта (без внешних SMTP серверов)
 */
async function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            jsonTransport: true
        });
    }
    return transporter;
}

/**
 * Отправка письма для восстановления доступа через электронную почту
 * Генерирует письмо, регистрирует его в логах безопасности и сохраняет в локальном почтовом ящике
 */
async function sendPasswordResetEmail(email, resetToken, resetUrl) {
    const senderEmail = 'security@taskmanager.local';
    const emailSubject = 'Восстановление доступа к аккаунту';
    const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px;">
                <h2 style="color: #1e293b; margin: 0; font-size: 20px;">🔐 Безопасность: Восстановление доступа</h2>
                <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Система управления задачами СПП (Лабораторная №3)</p>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">Здравствуйте!</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">
                Для вашей учетной записи (<strong>${email}</strong>) был запрошен сброс пароля.
            </p>
            
            <div style="text-align: center; margin: 28px 0;">
                <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                    🔑 Перейти к установке нового пароля
                </a>
            </div>

            <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 14px 18px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Одноразовый проверочный токен:</p>
                <code style="display: block; word-break: break-all; font-family: monospace; font-size: 13px; color: #0f172a; background: #ffffff; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0;">${resetToken}</code>
            </div>

            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
                Прямая ссылка для перехода: <br>
                <a href="${resetUrl}" style="color: #2563eb; word-break: break-all; font-size: 12px;">${resetUrl}</a>
            </p>

            <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 14px; font-size: 12px; color: #94a3b8;">
                <p style="margin: 0 0 4px 0;">⏱️ Срок действия ссылки и токена — <strong>15 минут</strong>.</p>
                <p style="margin: 0;">Если вы не запрашивали восстановление пароля, проигнорируйте это сообщение.</p>
            </div>
        </div>
    `;

    const emailText = 'Здравствуйте!\n\n' +
                      `Для вашей учетной записи (${email}) был запрошен сброс пароля.\n\n` +
                      `Перейдите по ссылке для смены пароля: ${resetUrl}\n\n` +
                      `Одноразовый токен: ${resetToken}\n\n` +
                      'Срок действия ссылки — 15 минут. Если вы не запрашивали сброс, проигнорируйте это письмо.';

    const emailRecord = {
        id: 'mail_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        to: email,
        from: senderEmail,
        subject: emailSubject,
        html: emailHtml,
        text: emailText,
        resetToken,
        resetUrl,
        sentAt: new Date().toISOString()
    };

    // Сохраняем в список локальных входящих сообщений
    sentEmailsList.unshift(emailRecord);
    if (sentEmailsList.length > 50) sentEmailsList.pop();

    try {
        const mail = await getTransporter();
        const message = {
            from: `"Система управления задачами СПП" <${senderEmail}>`,
            to: email,
            subject: emailSubject,
            text: emailText,
            html: emailHtml
        };

        const info = await mail.sendMail(message);

        logger.info(`[EMAIL] Сформировано письмо восстановления пароля для ${email}`, {
            messageId: info.messageId,
            to: email,
            resetToken
        });

        return {
            success: true,
            messageId: info.messageId,
            emailRecord
        };
    } catch (err) {
        logger.error(`[EMAIL ERROR] Ошибка формирования письма для ${email}: ${err.message}`);
        return {
            success: true,
            error: err.message,
            emailRecord
        };
    }
}

/**
 * Получение списка отправленных писем (входящих для пользователя)
 */
function getSentEmails(forEmail) {
    if (forEmail) {
        return sentEmailsList.filter(m => m.to.toLowerCase() === forEmail.trim().toLowerCase());
    }
    return [...sentEmailsList];
}

/**
 * Получение последнего отправленного письма
 */
function getLastEmail(forEmail) {
    const list = getSentEmails(forEmail);
    return list.length > 0 ? list[0] : null;
}

/**
 * Очистка почтового ящика (для тестов)
 */
function clearSentEmails() {
    sentEmailsList.length = 0;
}

module.exports = {
    sendPasswordResetEmail,
    getSentEmails,
    getLastEmail,
    clearSentEmails
};
