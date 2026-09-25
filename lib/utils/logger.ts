import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['password', 'routerPassword', 'token', 'secret', '*.authorization', '*.cookie'],
})