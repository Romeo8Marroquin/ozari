import express from "express";
import usersRouter from "./routes/userRoute";
import dotenv from "dotenv";
import { prismaClient } from "./controllers/userController";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigin = process.env.CORS_ORIGIN;

      if (!allowedOrigin) {
        return callback(
          new Error("CORS no permitido: origen no configurado"),
          false
        );
      }

      if (origin === allowedOrigin) {
        return callback(null, true);
      }
      return callback(new Error("CORS no permitido para este origen"), false);
    },
  })
);

app.get("/", (req, res) => {
  res.send("Hello, TypeScript with Express and ESM!");
});

app.use("/user", usersRouter);

const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

const databaseShutdown = async () => {
  console.log("Cerrando servidor...");
  await prismaClient.$disconnect();
  server.close(() => {
    console.log("Servidor cerrado");
    process.exit(0);
  });
};

process.on("SIGINT", databaseShutdown);
process.on("SIGTERM", databaseShutdown);
