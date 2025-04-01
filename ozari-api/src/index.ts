import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { prismaClient } from './controllers/userController';
import usersRouter from './routes/userRoute';

dotenv.config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const frontendDomain = process.env.TZ_FRONTEND_DOMAIN ?? 'http://localhost:3001';
const allowedOrigin = process.env.CORS_ORIGIN;

const cspDirectives = {
  connectSrc: ["'self'", frontendDomain],
  defaultSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  frameAncestors: ["'self'"],
  imgSrc: ["'self'", frontendDomain, 'data:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", frontendDomain],
  styleSrc: ["'self'", frontendDomain],
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: 'deny' }));

const limiter = rateLimit({
  max: 100,
  windowMs: 15 * 60 * 1000, // 15 minutes
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!allowedOrigin) {
        callback(new Error('CORS no permitido: origen no configurado'), false);
        return;
      }
      if (origin === allowedOrigin) {
        callback(null, true);
        return;
      }
      console.error(`Origen no permitido: ${origin ?? 'desconocido'}`);
      callback(new Error('CORS no permitido para este origen'), false);
    },
  }),
);

app.get('/', (req, res) => {
  res.send('Hello, TypeScript with Express and ESM!');
});

app.use('/user', usersRouter);

const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${String(port)}`);
});

const databaseShutdown = async () => {
  console.log('Cerrando servidor...');
  await prismaClient.$disconnect();
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  databaseShutdown().catch((err: unknown) => {
    console.error('Error during shutdown:', err);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  databaseShutdown().catch((err: unknown) => {
    console.error('Error during shutdown:', err);
    process.exit(1);
  });
});
