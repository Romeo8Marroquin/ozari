import { Request, Response } from 'express';
import i18next from 'i18next';

import { prismaClient } from '../database/databaseClient.js';
import { encryptKmsAsync, encryptSha256Sync } from '../helpers/encryption.js';
import { RolesEnum } from '../models/enums/rolesEnum.js';
import { CreateUserRequestModel, SignInUserRequestModel } from '../models/request/userModels.js';

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });
    res.json({ data: users });
  } catch {
    res.status(500).json({ error: 'Error al obtener la lista de usuarios' });
  }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const user = await prismaClient.user.findFirst({
      where: { id: Number(id), isActive: true },
    });
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    res.json({ data: user });
  } catch {
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  const { email, fullName, password, termsAccepted } = req.body as CreateUserRequestModel;

  try {
    const emailSha = encryptSha256Sync(email);
    const existingUser = await prismaClient.user.findUnique({
      where: { emailSha },
    });
    if (existingUser) {
      res.status(409).json({ error: i18next.t('api.userController.createUser.genericError') });
      return;
    }
    const encryptedPassword = await encryptKmsAsync(password);
    const encryptedName = await encryptKmsAsync(fullName);
    const encryptedEmail = await encryptKmsAsync(email);
    await prismaClient.user.create({
      data: {
        emailKms: encryptedEmail,
        emailSha,
        fullNameKms: encryptedName,
        passwordKms: encryptedPassword,
        passwordSha: encryptSha256Sync(password),
        roleId: RolesEnum.Client,
        termsAccepted,
      },
    });
    res.status(201).json({ message: i18next.t('api.userController.createUser.userCreated') });
  } catch (error) {
    console.log(i18next.t('api.userController.createUser.logs.serverError'), error);
    res.status(500).json({ error: i18next.t('api.userController.createUser.genericError') });
  }
};

export const signInUser = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as SignInUserRequestModel;

  try {
    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findUnique({
      where: { emailSha, isActive: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const inputPasswordHash = encryptSha256Sync(password);
    if (inputPasswordHash !== user.passwordSha) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    res.json({ message: 'Login exitoso' });
  } catch {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

// export const updateUser = async (
//   req: Request,
//   res: Response,
// ): Promise<void> => {
//   const { id } = req.params;
//   const updateData = req.body;
//   try {
//     const updatedUser = await prismaClient.user.update({
//       data: updateData,
//       where: { id: Number(id) },
//     });
//     res.json({ data: updatedUser, message: `Usuario ${id} actualizado` });
//   } catch {
//     res.status(500).json({ error: 'Error al actualizar el usuario' });
//   }
// };

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const deletedUser = await prismaClient.user.update({
      data: { isActive: false },
      where: { id: Number(id) },
    });
    res.json({ data: deletedUser, message: `Usuario ${id} eliminado` });
  } catch {
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
};
