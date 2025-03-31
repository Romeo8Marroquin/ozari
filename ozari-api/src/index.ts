import express from "express";
import usersRouter from "./routes/users";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, TypeScript with Express and ESM!");
});

app.use("/user", usersRouter);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
