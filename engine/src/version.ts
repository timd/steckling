import pkg from "../package.json";

/** Single source of truth for the CLI version — mirrors package.json. */
export const version: string = pkg.version;
