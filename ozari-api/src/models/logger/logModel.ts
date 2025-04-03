import { UUID } from 'node:crypto';

export interface LoggerStorage {
  hostname: string;
  ips: string[];
  method: string;
  originalUrl: string;
  params: object;
  protocol: string;
  query: object;
  requestUuid: UUID;
  timestamp: Date;
  userAgent?: string;
}
