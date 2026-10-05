/**
 * Registers the resolution hook that lets `node --experimental-strip-types`
 * import the app's own modules. See ts-resolve.mjs for why it is needed.
 *
 * Used via: node --experimental-strip-types --import ./scripts/register-ts.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve.mjs", pathToFileURL(import.meta.filename));