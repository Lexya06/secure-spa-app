const logger = require('./logger');

/**
 * Отправка письма для восстановления доступа через почтовый сервис Resend (HTTPS REST API)
 * Отправка выполняется строго через защищенный HTTPS (порт 443), без использования сетевого SMTP.
 */
async function sendPasswordResetEmail(email, resetToken, resetUrl) {
    const resendApiKey = (process.env.RESEND_API_KEY || '').trim();

    const emailSubject = '🔐 Восстановление доступа к аккаунту';
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

            <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Одноразовый проверочный код:</p>
                <code style="display: inline-block; font-family: monospace; font-size: 22px; font-weight: bold; color: #1e40af; background: #ffffff; padding: 8px 20px; border-radius: 6px; border: 1px solid #bfdbfe; letter-spacing: 4px;">${resetToken}</code>
            </div>

            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
                Прямая ссылка для перехода: <br>
                <a href="${resetUrl}" style="color: #2563eb; word-break: break-all; font-size: 12px;">${resetUrl}</a>
            </p>

            <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 14px; font-size: 12px; color: #94a3b8;">
                <p style="margin: 0 0 4px 0;">⏱️ Срок действия ссылки и кода — <strong>15 минут</strong>.</p>
                <p style="margin: 0;">Если вы не запрашивали восстановление пароля, просто проигнорируйте это сообщение.</p>
            </div>
        </div>
    `;

    const emailText = 'Здравствуйте!\n\n' +
                      `Для вашей учетной записи (${email}) был запрошен сброс пароля.\n\n` +
                      `Перейдите по ссылке для смены пароля: ${resetUrl}\n\n` +
                      `Одноразовый проверочный код: ${resetToken}\n\n` +
                      'Срок действия кода и ссылки — 15 минут. Если вы не запрашивали сброс, проигнорируйте это письмо.';

    const emailRecord = {
        id: 'mail_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        to: email,
        from: 'TaskManager СПП <onboarding@resend.dev>',
        subject: emailSubject,
        html: emailHtml,
        text: emailText,
        resetToken,
        resetUrl,
        sentAt: new Date().toISOString()
    };

    // В тестовой среде Jest не отправляем реальные запросы через интернет
    if (process.env.NODE_ENV === 'test') {
        logger.info(`[EMAIL TEST MOCK] Сформировано письмо восстановления пароля для ${email}`);
        return {
            success: true,
            deliveryMethod: 'resend',
            messageId: 'test_mock_' + Date.now(),
            emailRecord
        };
    }

    if (!resendApiKey) {
        throw new Error('Ключ RESEND_API_KEY не указан в файле .env. Реальная отправка писем невозможна.');
    }

    // В бесплатном тарифе Resend отправка производится от имени onboarding@resend.dev

    const fromAddress = 'TaskManager <onboarding@resend.dev>';
    const replyTo = process.env.EMAIL_FROM || 'arikhartmen75@gmail.com';

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: fromAddress,
            to: [email],
            reply_to: replyTo,
            subject: emailSubject,
            html: emailHtml,
            text: emailText
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        let errorMsg = errorBody;
        try {
            const parsed = JSON.parse(errorBody);
            if (parsed.message) errorMsg = parsed.message;
        } catch {
            // оставляем как есть
        }

        logger.error(`[EMAIL ERROR] Ошибка отправки Resend для ${email}: ${errorMsg}`);

        if (response.status === 403 && errorMsg.includes('only send testing emails to your own email address')) {
            throw new Error(`В бесплатном тарифе Resend без подтвержденного домена отправка разрешена только на ваш подтвержденный адрес (${replyTo}).`);
        }

        throw new Error(`Ошибка сервиса отправки почты Resend (${response.status}): ${errorMsg}`);
    }

    const data = await response.json();

    logger.info(`[EMAIL RESEND] Реальное письмо успешно отправлено на ${email}`, {
        messageId: data.id,
        to: email
    });

    return {
        success: true,
        deliveryMethod: 'resend',
        messageId: data.id,
        emailRecord
    };
}

module.exports = {
    sendPasswordResetEmail
};

