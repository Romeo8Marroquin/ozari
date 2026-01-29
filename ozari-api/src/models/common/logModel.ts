import { type UUID } from "node:crypto";

export interface LoggerStorage {
  body: object;
  query: object;
  hostname: string;
  ips: string[];
  method: string;
  originalUrl: string;
  params: object;
  protocol: string;
  requestUuid: UUID;
  timestamp: Date;
  userAgent: string | undefined;
}
