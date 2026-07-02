import _sodium from "libsodium-wrappers";

/**
 * libsodium compiles to WebAssembly and must finish initialising before any
 * primitive is called. We memoise the ready promise so every helper can await a
 * single initialisation regardless of call order.
 */
export type Sodium = typeof _sodium;

let ready: Promise<Sodium> | null = null;

export async function getSodium(): Promise<Sodium> {
  ready ??= _sodium.ready.then(() => _sodium);
  return ready;
}
