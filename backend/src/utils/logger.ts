import pino from 'pino';

// Redact sensitive keys from logs to prevent credentials leaking
const redactKeys = [
    'password',
    'token',
    'apiKey',
    'geminiApiKey',
    'accessToken',
    'Authorization',
    'x-access-token',
    'req.headers.authorization',
];

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    redact: {
        paths: redactKeys,
        censor: '[REDACTED]',
    },
    transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
    serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
    },
});
