import { Request, Response, NextFunction } from "express";
import { emailRegex, fullNameRegex, passwordRegex } from "../helpers/regex";
import { CreateUserRequestModel } from "../models/request/userModels";

export function validateCreateUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { fullName, email, password, confirmPassword, termsAccepted } =
    req.body;

  if (
    typeof fullName !== "string" ||
    fullName.trim() === "" ||
    !fullNameRegex.test(fullName)
  ) {
    res.status(400).json({ error: "El nombre es requerido y debe ser válido" });
    return;
  }

  if (typeof email !== "string" || !emailRegex.test(email)) {
    res.status(400).json({ error: "El correo debe ser válido." });
    return;
  }

  if (typeof password !== "string" || !passwordRegex.test(password)) {
    res.status(400).json({
      error:
        "Password debe tener al menos 6 caracteres, incluyendo letras, símbolos y números.",
    });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json({ error: "Las contraseñas no coinciden." });
    return;
  }

  if (typeof termsAccepted !== "boolean" || termsAccepted !== true) {
    res.status(400).json({ error: "termsAccepted debe ser verdadero." });
    return;
  }

  const validatedBody: CreateUserRequestModel = {
    fullName: fullName.trim(),
    email,
    password,
    confirmPassword,
    termsAccepted,
  };

  req.body = validatedBody;
  next();
}
