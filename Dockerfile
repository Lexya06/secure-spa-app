FROM node:20-alpine

# Устанавливаем инструменты сборки C++ для компиляции native модуля better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Копируем описание зависимостей
COPY package*.json ./

# Устанавливаем зависимости с компиляцией бинарных модулей
RUN npm ci --omit=dev

# Копируем остальной исходный код
COPY . .

# Создаем директории для данных, логов и файлов
RUN mkdir -p uploads logs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
