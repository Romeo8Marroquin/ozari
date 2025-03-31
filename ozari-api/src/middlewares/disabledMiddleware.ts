import { Request, Response } from "express";

export const disableEndpoint = (_: Request, res: Response) => {
  res
    .status(403)
    .json({ error: "Este endpoint está deshabilitado temporalmente." });
};
