/**
 * Returns the element that should receive focus at a modal boundary.
 * `null` means the modal itself when it contains no interactive controls;
 * `undefined` means the browser can continue its normal tab order.
 */
export function wrappedFocusTarget<T>(
  focusable: readonly T[],
  active: T | null,
  reverse: boolean,
): T | null | undefined {
  if (focusable.length === 0) return null;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!active || !focusable.includes(active)) return reverse ? last : first;
  if (reverse && active === first) return last;
  if (!reverse && active === last) return first;
  return undefined;
}
