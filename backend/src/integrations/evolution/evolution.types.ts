/**
 * Failures raised by the native Evolution HTTP client. The messages are fixed
 * on purpose: the provider response body and the `apikey` header must never be
 * echoed into logs, API responses or persisted provider errors.
 */
export class EvolutionRequestRejectedError extends Error {
  constructor() {
    super("Evolution rejected the request");
    this.name = "EvolutionRequestRejectedError";
  }
}

export class EvolutionTemporarilyUnavailableError extends Error {
  constructor() {
    super("Evolution is temporarily unavailable");
    this.name = "EvolutionTemporarilyUnavailableError";
  }
}
