/**
 * Утилиты для работы с файлами и декодирования имен
 */

const cp1252Map = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};

/**
 * Корректировка кодировки имени файла.
 * Multer/busboy по умолчанию декодирует заголовки multipart/form-data в кодировке latin1.
 * Для не-ASCII символов (включая русский язык/кириллицу) это приводит к искажению (mojibake).
 * Данная функция безопасно восстанавливает исходную строку в кодировке UTF-8.
 *
 * @param {string} originalName - Исходное имя файла от Multer или из базы данных
 * @returns {string} Корректное имя файла в UTF-8
 */
function fixOriginalName(originalName) {
    if (!originalName || typeof originalName !== 'string') {
        return originalName;
    }

    // 1. Если в строке уже есть явная кириллица (диапазон \u0400-\u04FF), повторное декодирование не требуется
    if (/[\u0400-\u04FF]/.test(originalName)) {
        return originalName;
    }

    try {
        // 2. Стандартный случай Multer: строка состоит из символов <= 255, представляющих байты UTF-8
        const hasCharsAbove255 = Array.from(originalName).some(ch => ch.charCodeAt(0) > 255);
        if (!hasCharsAbove255) {
            const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
            if (!decoded.includes('\uFFFD') && decoded !== originalName) {
                return decoded;
            }
            return originalName;
        }

        // 3. Fallback: если символы 0x80-0x9F были отображены в символы Windows-1252 (cp1252)
        const bytes = [];
        for (let i = 0; i < originalName.length; i++) {
            const code = originalName.charCodeAt(i);
            if (cp1252Map[code]) {
                bytes.push(cp1252Map[code]);
            } else if (code <= 0xFF) {
                bytes.push(code);
            } else {
                return originalName;
            }
        }
        const decodedCp = Buffer.from(bytes).toString('utf8');
        if (!decodedCp.includes('\uFFFD') && decodedCp !== originalName) {
            return decodedCp;
        }
    } catch {
        // Fallback
    }

    return originalName;
}

module.exports = {
    fixOriginalName
};
