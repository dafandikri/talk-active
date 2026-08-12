export async function optionalUserId(request: Request): Promise<string | null> {
  if (!process.env.DATABASE_URL?.trim() || !process.env.BETTER_AUTH_SECRET?.trim()) return null;
  const { auth } = await import('./auth');
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

export async function requireUserId(request: Request): Promise<string> {
  const userId = await optionalUserId(request);
  if (!userId) {
    const { ApiProblem } = await import('./api/http');
    throw new ApiProblem(401, 'authentication_required', 'Sign in to manage synced account data.');
  }
  return userId;
}
