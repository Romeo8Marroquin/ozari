import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  CreateUserRequestModel,
  SignInUserRequestModel,
} from "../models/request/userModels";
import { encryptKmsAsync, encryptSha256Sync } from "../helpers/encryption";
import { Roles } from "../models/enums/roles";

export const prismaClient = new PrismaClient();

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });
    res.json({ data: users });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener la lista de usuarios" });
  }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const user = await prismaClient.user.findFirst({
      where: { id: Number(id), isActive: true },
    });
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json({ data: user });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el usuario" });
  }
};

export const createUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { fullName, email, password, termsAccepted } =
    req.body as CreateUserRequestModel;

  try {
    const emailSha = encryptSha256Sync(email);
    const existingUser = await prismaClient.user.findUnique({
      where: { emailSha },
    });
    if (existingUser) {
      res
        .status(409)
        .json({ error: "Ha ocurrido un error, por favor intente de nuevo" });
      return;
    }
    const encryptedPassword = await encryptKmsAsync(password);
    const encryptedName = await encryptKmsAsync(fullName);
    const encryptedEmail = await encryptKmsAsync(email);
    await prismaClient.user.create({
      data: {
        fullNameKms: encryptedName,
        emailSha,
        emailKms: encryptedEmail,
        passwordKms: encryptedPassword,
        passwordSha: encryptSha256Sync(password),
        termsAccepted,
        roleId: Roles.Client,
      },
    });
    res.status(201).json({ message: "Usuario creado exitosamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error al crear el usuario" });
  }
};

export const signInUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { email, password } = req.body as SignInUserRequestModel;

  try {
    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findUnique({
      where: { emailSha, isActive: true },
    });
    if (!user) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    const inputPasswordHash = encryptSha256Sync(password);
    if (inputPasswordHash !== user.passwordSha) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    res.json({ message: "Login exitoso" });
  } catch (error) {
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
};

export const updateUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const updateData = req.body;
  try {
    const updatedUser = await prismaClient.user.update({
      where: { id: Number(id) },
      data: updateData,
    });
    res.json({ message: `Usuario ${id} actualizado`, data: updatedUser });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el usuario" });
  }
};

export const deleteUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  try {
    const deletedUser = await prismaClient.user.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });
    res.json({ message: `Usuario ${id} eliminado`, data: deletedUser });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar el usuario" });
  }
};
