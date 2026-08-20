export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND'
      || !specifier.startsWith('.')
      || /\.[cm]?[jt]sx?$/u.test(specifier)
    ) {
      throw error;
    }
    return nextResolve(`${specifier}.ts`, context);
  }
}
