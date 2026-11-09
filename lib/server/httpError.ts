/** An error with a status the API should answer with (message is user-facing, pt-BR). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * Extra machine-readable facts the screen can act on — the closed months that stopped an
     * instalment plan, for instance, which the form turns into a shortcut to reopen one. It is
     * sent as `details` in the JSON body; never anything the message does not already say.
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
