// The in-memory chrome stub the src-donut tests run against. Installed onto
// globalThis before the module under test is called — every src-donut module
// touches chrome only inside functions, never at module evaluation, so a
// runtime stub is all it takes. (This is the whole reason the src1
// brace-matched extractFunction harnesses could die.)

export function installChrome(overrides = {}) {
  const local = new Map();
  const sync = new Map();

  function makeArea(area) {
    return {
      async get(keys) {
        if (keys == null) return Object.fromEntries(area);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) {
          if (area.has(key)) out[key] = structuredClone(area.get(key));
        }
        return out;
      },
      async set(obj) {
        for (const [key, value] of Object.entries(obj)) {
          area.set(key, structuredClone(value));
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) area.delete(key);
      }
    };
  }

  const api = {
    storage: { local: makeArea(local), sync: makeArea(sync) },
    runtime: { getPlatformInfo: async () => ({ os: "stub" }) },
    alarms: { create() {}, clear() {} },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      onCreated: { addListener() {} }
    },
    windows: { onRemoved: { addListener() {} } },
    ...overrides
  };

  globalThis.chrome = api;
  return { local, sync, api };
}
