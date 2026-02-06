import winston from "winston";
import { asyncLocalStorage } from "./context.js";

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

  const shortUuid = requestUuid ? (requestUuid as string).slice(0, 8) : "";
  const formattedLog = [
    `[${timestamp as string}]`,
    !firstLog && requestUuid ? `[${shortUuid}]` : "",
    `[${level}]`,
    message as string,
  ];

  if (!firstLog) {
    return formattedLog.filter(Boolean).join(" ");
  }

  // Include full context on first log
  const contextLogs = [
    /* c8 ignore next */
    requestUuid ? `\n  → RequestUuid: ${requestUuid as string}` : "",
    /* c8 ignore next 2 */
    info["protocol"] ? `\n  → Protocol: ${info["protocol"] as string}` : "",
    method && originalUrl
      ? `\n  → ${method as string} ${originalUrl as string}`
      : "",
    hostname ? `\n  → Host: ${hostname as string}` : "",
    userAgent ? `\n  → User-Agent: ${userAgent as string}` : "",
    /* c8 ignore next */
    info["body"] ? `\n  → Body: ${JSON.stringify(info["body"])}` : "",
    /* c8 ignore next */
    info["params"] ? `\n  → Params: ${JSON.stringify(info["params"])}` : "",
    /* c8 ignore next 2 */
    info["query"] ? `\n  → Query: ${JSON.stringify(info["query"])}` : "",
    info["ips"] ? `\n  → IPs: ${JSON.stringify(info["ips"])}` : "",
  ];

  return [...formattedLog, ...contextLogs].filter(Boolean).join(" ");
});

const addContextFormat = winston.format((info) => {
  const context = asyncLocalStorage.getStore();
  if (context) {
    info["requestUuid"] = context.requestUuid;
    info["method"] = context.method;
    info["originalUrl"] = context.originalUrl;
    info["hostname"] = context.hostname;
    info["ips"] = context.ips;
    info["timestamp"] = context.timestamp;
    info["userAgent"] = context.userAgent;
  }
  return info;
});

// CLI format for development
const cliFormat = combine(
  addContextFormat(),
  timestamp({ format: "DD/MM/YYYY hh:mm:ss.SSS A" }),
  cli(),
  customCliFormat,
  colorize({ all: true }),
);

// JSON format for production
const jsonFormat = combine(
  addContextFormat(),
  timestamp({ format: "DD/MM/YYYY hh:mm:ss.SSS Z" }),
  json(),
);

export const logger = winston.createLogger({
  level: process.env["LOG_LEVEL"] ?? "info",
  /* c8 ignore next */
  format: process.env["NODE_ENV"] === "production" ? jsonFormat : cliFormat,
  transports: [new winston.transports.Console()],
});
