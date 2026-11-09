/**
 * Best-effort human message from anything a repository can throw. The API and the HTTP
 * repository already produce user-facing messages (pt-BR); this only unwraps them.
 */
export function toStorageErrorMessage(err: unknown, fallback = 'Erro ao acessar os dados.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string' &&
    (err as { message: string }).message
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
