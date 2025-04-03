import dotenv from 'dotenv';
dotenv.config();
import winston from 'winston';

import { asyncLocalStorage } from '../app.js';

const { cli, colorize, combine, json, printf, timestamp } = winston.format;

const customCliFormat = printf((info) => {
  const {
    firstLog,
    hostname,
    level,
    message,
    method,
    originalUrl,
    requestUuid,
    timestamp,
    userAgent,
  } = info;
  const shortUuid = requestUuid ? (requestUuid as string).slice(0, 8) : '';
  const formattedLog = [
    `[${timestamp as string}]`,
    !firstLog && requestUuid ? `[${shortUuid}]` : '',
    `[${level}]`,
    message as string,
  ];
  if (!firstLog) return formattedLog.filter(Boolean).join(' ');
  const contextLogs = [
    requestUuid ? `\n  → RequestUuid: ${requestUuid as string}` : '',
    info.protocol ? `\n  → Protocol: ${info.protocol as string}` : '',
    method && originalUrl ? `\n  → ${method as string} ${originalUrl as string}` : '',
    hostname ? `\n  → Host: ${hostname as string}` : '',
    userAgent ? `\n  → User-Agent: ${userAgent as string}` : '',
    info.body ? `\n  → Body: ${JSON.stringify(info.body)}` : '',
    info.params ? `\n  → Params: ${JSON.stringify(info.params)}` : '',
    info.query ? `\n  → Query: ${JSON.stringify(info.query)}` : '',
    info.ips ? `\n  → IPs: ${JSON.stringify(info.ips)}` : '',
  ];
  return [...formattedLog, ...contextLogs].filter(Boolean).join(' ');
});

const addContextFormat = winston.format((info) => {
  const context = asyncLocalStorage.getStore();
  if (context) {
    info.requestUuid = context.requestUuid;
    info.method = context.method;
    info.originalUrl = context.originalUrl;
    info.hostname = context.hostname;
    info.ips = context.ips;
    info.timestamp = context.timestamp;
    info.userAgent = context.userAgent;
  }
  return info;
});

const cliFormat = combine(
  addContextFormat(),
  timestamp({ format: 'DD/MM/YYYY hh:mm:ss.SSS A' }),
  cli(),
  customCliFormat,
  colorize({ all: true }),
);

const jsonFormat = combine(
  addContextFormat(),
  timestamp({ format: 'DD/MM/YYYY hh:mm:ss.SSS A' }),
  json(),
);
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
