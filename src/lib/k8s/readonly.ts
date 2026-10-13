const READ_ONLY_PREFIXES = ["list", "read", "get"] as const;

export function isReadOnlyMethod(name: string): boolean {
  return READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Wraps an API client so that any method that is not list*, read* or get* throws.
 * This is a second line of defence behind the ClusterSource interface, which
 * already exposes read methods only.
 */
export function readOnlyClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && typeof value === "function") {
        if (prop === "constructor") return value;
        if (!isReadOnlyMethod(prop)) {
          return () => {
            throw new Error(`Blocked non-read Kubernetes operation: ${prop}`);
          };
        }
        return value.bind(target);
      }
      return value;
    },
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
