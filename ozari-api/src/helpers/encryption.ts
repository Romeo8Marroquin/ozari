import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import crypto from "crypto";

export function encryptSha256Sync(target: string): string {
  return crypto.createHash("sha256").update(target).digest("hex");
}

const kmsClient = new KMSClient({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY ?? "",
    secretAccessKey: process.env.AWS_SECRET_KEY ?? "",
  },
  region: process.env.AWS_REGION ?? "",
});

const keyId = process.env.AWS_KEY_ARN ?? "";

export async function decryptKmsAsync(target: string): Promise<string> {
  const ciphertextBlob = Buffer.from(target, "base64");
  const command = new DecryptCommand({
    CiphertextBlob: ciphertextBlob,
    KeyId: keyId,
  });

  const response = await kmsClient.send(command);
  return response.Plaintext
    ? Buffer.from(response.Plaintext).toString("utf-8")
    : "";
}

export async function encryptKmsAsync(target: string): Promise<string> {
  const command = new EncryptCommand({
    KeyId: keyId,
    Plaintext: Buffer.from(target),
  });

  const response = await kmsClient.send(command);

  return response.CiphertextBlob
    ? Buffer.from(response.CiphertextBlob).toString("base64")
    : "";
}
