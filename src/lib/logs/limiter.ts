/** Caps how many log streams can be open at once. Acquire returns a release function, or null when full. */
export function createLimiter(max: number) {
  let active = 0;
  return {
    acquire(): (() => void) | null {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
    get active() {
      return active;
    },
    max,
  };
}
