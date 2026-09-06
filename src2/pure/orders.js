// Order normalization, shared by the startup-step order and the query-source
// order. Both are user-arranged lists of known ids with a canonical default;
// both need the same three repairs for a saved order that came from an older
// version: drop unknown ids, drop duplicates, and slot ids the saved order
// predates back where they belong by default.
//
// A step added by an update is absent from every saved order. Putting it
// where it belongs by default beats tacking it on the end, where it would run
// last and be easy to miss.
export function slotMissingDefaults(order, defaultIds) {
  const ids = [...defaultIds];
  const known = Array.isArray(order) ? order.filter(id => ids.includes(id)) : [];
  const merged = [...new Set(known)];

  ids.forEach((id, defaultIndex) => {
    if (!merged.includes(id)) {
      merged.splice(Math.min(defaultIndex, merged.length), 0, id);
    }
  });

  return merged;
}
