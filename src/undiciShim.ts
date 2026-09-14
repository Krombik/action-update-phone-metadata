// The @actions/* packages pull in undici for two things: the `fetch` that Node 24
// already provides as a global, and a `ProxyAgent` that is only constructed when
// http_proxy/https_proxy is set. Bundling undici for that costs ~670 KB, well over a
// third of the action, so it is aliased to this shim in tsdown.config.ts.

export const fetch = globalThis.fetch;
export class ProxyAgent {
  constructor() {
    throw new Error(
      'A proxy is configured, but undici was stripped from this action bundle. ' +
        'Drop the `undici` alias in tsdown.config.ts to restore proxy support.',
    );
  }
}
