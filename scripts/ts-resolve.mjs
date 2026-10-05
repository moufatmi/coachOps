/**
 * Module resolution hook for `node --experimental-strip-types`.
 *
 * The app's own modules use extensionless relative imports and the `@/` alias,
 * both of which Next.js resolves but Node does not. This hook teaches Node the
 * same rules so the sync tests can import the real source instead of a copy.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  let target;

  if (specifier.startsWith("@/")) {
    target = resolvePath(ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    target = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  } else {
    return nextResolve(specifier, context);
  }

  // Try the specifier, then each TypeScript-flavoured extension.
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
  ]) {
    if (existsSync(candidate) && !candidate.endsWith(".json")) {
      try {
        return await nextResolve(pathToFileURL(candidate).href, context);
      } catch {
        // Fall through and try the next candidate.
      }
    }
  }

  return nextResolve(specifier, context);
}