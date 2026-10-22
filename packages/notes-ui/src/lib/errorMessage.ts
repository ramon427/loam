/** The message of a failed operation, for showing to the user. */
export const errorMessage = (error: unknown, fallback = "Try again.") =>
  error instanceof Error && error.message ? error.message : fallback;
