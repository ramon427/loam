/** A failure the renderer can classify by `code` and `status`, like an HTTP error. */
export class StoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

export const noteNotFound = () => new StoreError("The note no longer exists.", "NOT_FOUND", 404);

export const invalidRequest = (detail: string) =>
  new StoreError(`Invalid request: ${detail}.`, "VALIDATION_ERROR", 400);
