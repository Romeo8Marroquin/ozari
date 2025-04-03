import winston from 'winston';

const { cli, colorize, combine, json, printf, timestamp } = winston.format;

const cliFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'DD/MM/YYYY hh:mm:ss.SSS A' }),
  cli(),
  printf((info) => `[${info.timestamp as string}] ${info.level}: ${info.message as string}`),
);

const jsonFormat = combine(timestamp({ format: 'DD/MM/YYYY hh:mm:ss.SSS A' }), json());

/**
 * Winston logger configuration.
 * @method error   level {0}
 * @method warn    level {1}
 * @method info    level {2}
 * @method http    level {3}
 * @method verbose level {4}
 * @method debug   level {5}
 * @method silly   level {6}
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [
    new winston.transports.Console({
      format: cliFormat,
    }),
    new winston.transports.File({
      filename: 'logs/external.log',
      format: jsonFormat,
    }),
  ],
});
