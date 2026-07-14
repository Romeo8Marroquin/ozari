import axios from 'axios';
import { useCallback, useState } from 'react';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { GalleryImage } from './useGalleryImages';

/** One minted presigned upload, mirrored from the backend `ProductImageUploadResponseModel`. */
export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

interface ProductImageUploadsResponse {
  uploads: PresignedUpload[];
}

/**
 * Uploads the staged gallery photos for a product create. Two hops, mirroring the backend design:
 *
 * 1. `POST /products/images/upload-url` (Admin-only, `skipErrorNotification` — the form owns the
 *    error surface) mints one short-lived presigned PUT URL per file.
 * 2. Each file is PUT **straight to R2** with a BARE axios call — deliberately NOT the `api`
 *    instance: R2 is a different origin and must never receive our Authorization/CSRF/device
 *    headers, and the app's interceptors (401 refresh, outage probe) don't apply to it. The
 *    Content-Type must match the presign exactly — it's bound into the signature.
 *
 * Returns the R2 keys in the same order as `images`; the create body references those keys.
 * `progress` maps image id → 0..1 for the per-thumbnail upload bars. Any failure rejects the whole
 * batch (the form keeps the staged files so the user just retries the submit).
 */
export function useProductImageUploads() {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);

  const uploadImages = useCallback(async (images: GalleryImage[]): Promise<string[]> => {
    if (images.length === 0) return [];
    setIsUploading(true);
    setProgress({});
    try {
      const response = await api.post<OzariSuccessResponse<ProductImageUploadsResponse>>(
        '/products/images/upload-url',
        {
          files: images.map((image) => ({
            contentType: image.file.type,
            contentLength: image.file.size,
          })),
        },
        { skipErrorNotification: true },
      );
      const uploads = response.data.data?.uploads ?? [];

      await Promise.all(
        uploads.map((upload, index) => {
          const image = images[index];
          return axios.put(upload.uploadUrl, image.file, {
            headers: { 'Content-Type': image.file.type },
            // The bare instance has NO default timeout (the app's 10s one lives on `api`) — without
            // this, a stalled PUT would pin `isUploading` forever and freeze the submit button.
            // Generous because a 5 MB photo on a slow mobile uplink legitimately takes a while.
            timeout: 120_000,
            onUploadProgress: (event) => {
              const ratio = event.total ? event.loaded / event.total : 0;
              setProgress((current) => ({ ...current, [image.id]: ratio }));
            },
          });
        }),
      );

      return uploads.map((upload) => upload.key);
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadImages, isUploading, progress };
}
