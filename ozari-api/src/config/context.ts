import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestUuid: string;
  method: string;
  originalUrl: string;
  hostname: string;
  ips: string[];
  protocol: string;
  timestamp: Date;
  userAgent: string | undefined;
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
