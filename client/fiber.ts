// NOTE: The plugin SDK exposes neither chat panes nor the composer queue. These helpers read React
// fibers attached to the app's DOM nodes. App-internal: they may break on a Paseo upgrade, and
// callers treat null as unavailable.

interface FiberLike {
  return: FiberLike | null;
  memoizedProps?: Record<string, unknown> | null;
}

const FIBER_KEY_PREFIX = "__reactFiber$";

/** Props of the nearest component at or above `element`, within `maxDepth` fibers, accepted by `accept` */
export function findFiberProps<Props extends Record<string, unknown>>(
  element: Element,
  maxDepth: number,
  accept: (props: Record<string, unknown>) => props is Props,
): Props | null {
  const record = element as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(record).find((key) => key.startsWith(FIBER_KEY_PREFIX));
  let fiber = fiberKey ? (record[fiberKey] as FiberLike) : null;
  for (let depth = 0; fiber && depth < maxDepth; depth++) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object" && accept(props)) return props;
    fiber = fiber.return;
  }
  return null;
}
