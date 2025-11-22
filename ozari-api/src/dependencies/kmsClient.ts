import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { getSecret } from '@helpers/ssmLoader';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export function encryptSha256Sync(target: string): string {
  return crypto.createHash('sha256').update(target).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(password, salt);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

const kmsClient = new KMSClient();

export async function decryptKmsAsync(target: string): Promise<string>;
export async function decryptKmsAsync(target: string[]): Promise<string[]>;
export async function decryptKmsAsync(target: string | string[]): Promise<string | string[]> {
  if (typeof target === 'string') {
    return decryptSingleKmsAsync(target);
  } else {
    const decryptPromises = target.map(decryptSingleKmsAsync);
    return Promise.all(decryptPromises);
  }
}

export async function encryptKmsAsync(target: string): Promise<string>;
export async function encryptKmsAsync(target: string[]): Promise<string[]>;
export async function encryptKmsAsync(target: string | string[]): Promise<string | string[]> {
  if (typeof target === 'string') {
    return encryptSingleKmsAsync(target);
  } else {
    const encryptPromises = target.map(encryptSingleKmsAsync);
    return Promise.all(encryptPromises);
  }
}

async function decryptSingleKmsAsync(target: string): Promise<string> {
  const ciphertextBlob = Buffer.from(target, 'base64');
  const KeyId = await getSecret('kms_key_arn');
  const command = new DecryptCommand({
    CiphertextBlob: ciphertextBlob,
    KeyId,
  });
  const response = await kmsClient.send(command);
  return response.Plaintext ? Buffer.from(response.Plaintext).toString('utf-8') : '';
}

async function encryptSingleKmsAsync(target: string): Promise<string> {
  const KeyId = await getSecret('kms_key_arn');
  const command = new EncryptCommand({
    KeyId,
    Plaintext: Buffer.from(target),
  });

  const response = await kmsClient.send(command);

  return response.CiphertextBlob ? Buffer.from(response.CiphertextBlob).toString('base64') : '';
}
