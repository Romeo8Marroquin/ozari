import { NextFunction, Request, Response } from 'express';

import { emailRegex, fullNameRegex, passwordRegex } from '../helpers/regex.js';
import { CreateUserRequestModel } from '../models/request/userModels.js';

export function validateCreateUser(req: Request, res: Response, next: NextFunction): void {
  const { confirmPassword, email, fullName, password, termsAccepted } =
    req.body as CreateUserRequestModel;

  if (typeof fullName !== 'string' || fullName.trim() === '' || !fullNameRegex.test(fullName)) {
    res.status(400).json({ error: 'El nombre es requerido y debe ser válido' });
    return;
  }

  if (typeof email !== 'string' || !emailRegex.test(email)) {
    res.status(400).json({ error: 'El correo debe ser válido.' });
    return;
  }

  if (typeof password !== 'string' || !passwordRegex.test(password)) {
    res.status(400).json({
      error: 'Password debe tener al menos 6 caracteres, incluyendo letras, símbolos y números.',
    });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    return;
  }

  if (typeof termsAccepted !== 'boolean' || !termsAccepted) {
    res.status(400).json({ error: 'termsAccepted debe ser verdadero.' });
    return;
  }

  const validatedBody: CreateUserRequestModel = {
    confirmPassword,
    email,
    fullName: fullName.trim(),
    password,
    termsAccepted,
  };

  req.body = validatedBody;
  next();
}
