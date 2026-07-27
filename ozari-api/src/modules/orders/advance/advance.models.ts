/**
 * `POST /orders/:id/advance` — ONE endpoint for every lifecycle move (forward, rewind, cancel). The
 * client never says WHICH kind it wants: it names the target status and the engine decides what that
 * move is and whether this actor may make it (`transitionKindFor`). That is why a new flow — a client
 * self-cancel, an auto-advance job — needs no new endpoint.
 */
export interface AdvanceOrderRequestModel {
  /** The `service_status` to move into (offered by the order's `actions`). */
  toStatusId: number;
  /** R2 object keys of photos already uploaded via `POST /orders/evidence/upload-url`. Required (in
   *  the target's resolved count range) when the step demands evidence; ignored otherwise. */
  evidenceKeys: string[];
  /** Why the order is being cancelled — required on a disruptive move, absent otherwise. */
  reason: string | undefined;
}

/** `POST /orders/evidence/upload-url` — one entry per photo the client wants to upload. */
export interface OrderEvidenceUploadFileModel {
  contentType: string;
  contentLength: number;
}

export interface CreateOrderEvidenceUploadsRequestModel {
  files: OrderEvidenceUploadFileModel[];
}

/** A minted presigned PUT (the browser uploads straight to R2, then sends the `key` back). */
export interface OrderEvidenceUploadModel {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface OrderEvidenceUploadsResponseModel {
  uploads: OrderEvidenceUploadModel[];
}
