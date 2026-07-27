import axios from 'axios';
import { useCallback, useState } from 'react';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';

/** One minted presigned upload, mirrored from the backend `OrderEvidenceUploadModel`. */
export interface EvidenceUpload {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

interface EvidenceUploadsResponse {
  uploads: EvidenceUpload[];
}

/**
 * Uploads tracking-evidence photos, the same two hops as the product gallery:
 *
 * 1. `POST /orders/evidence/upload-url` (Admin + Driver, `skipErrorNotification` — the dialog owns
 *    the error surface) mints one short-lived presigned PUT per file;
 * 2. each file is PUT **straight to R2** with a BARE axios call — deliberately NOT the `api`
 *    instance: R2 is a different origin and must never receive our Authorization/CSRF/device
 *    headers, and the app's interceptors don't apply to it. The Content-Type must match the presign
 *    exactly (it's bound into the signature).
 *
 * Returns the minted KEYS in the same order as the files — that's what `advance` records; the server
 * derives the public URL itself. A failure rejects the whole batch and the dialog keeps the picked
 * files, so the user just retries.
 */
export function useOrderEvidenceUploads() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadEvidence = useCallback(async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    setIsUploading(true);
    try {
      const response = await api.post<OzariSuccessResponse<EvidenceUploadsResponse>>(
        '/orders/evidence/upload-url',
        {
          files: files.map((file) => ({
            contentType: file.type,
            contentLength: file.size,
          })),
        },
        { skipErrorNotification: true },
      );
      const uploads = response.data.data?.uploads ?? [];

      await Promise.all(
        uploads.map((upload, index) =>
          axios.put(upload.uploadUrl, files[index], {
            headers: { 'Content-Type': files[index].type },
            // The bare instance has no default timeout (the app's lives on `api`) — without this a
            // stalled PUT would pin `isUploading` forever. Generous: a photo on a mobile uplink in
            // the field legitimately takes a while.
            timeout: 120_000,
          }),
        ),
      );

      return uploads.map((upload) => upload.key);
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadEvidence, isUploading };
}
