/**
 * A photo STAGED for a lifecycle move — the file that will be uploaded plus the local object-URL the
 * dialog previews it with. Shared by both evidence dialogs (the single-step confirm and the admin's
 * multi-step jump) so a photo is staged, previewed and released the same way in each.
 *
 * The object URL is a live handle on the file's bytes: whoever mints one owns revoking it (on
 * removal, on reset, and on unmount). That is the whole reason this is a MODEL and not a bare `File`.
 */
export interface EvidencePhoto {
  id: string;
  file: File;
  previewUrl: string;
}

let localIdCounter = 0;

/** Monotonic local id — enough to key a grid within one mount, and stable across a re-add. */
export const nextPhotoId = (): string => `evidence-${++localIdCounter}`;

/** Stage files: mint one preview handle per file. The caller keeps the returned photos (and must
 *  eventually {@link revokeEvidencePhotos} them). */
export const mintEvidencePhotos = (files: File[]): EvidencePhoto[] =>
  files.map((file) => ({ id: nextPhotoId(), file, previewUrl: URL.createObjectURL(file) }));

/** Release the preview handles of photos that are no longer staged. */
export const revokeEvidencePhotos = (photos: EvidencePhoto[]): void => {
  for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
};
