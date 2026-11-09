/** The app's own public URL, for redirects back into the app. */
export function appBaseUrl(): string {
  return process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '') || 'http://localhost:3000';
}
