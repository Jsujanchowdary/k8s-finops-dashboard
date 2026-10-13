import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="mt-1 text-xl font-semibold">Not found in this cluster</h1>
      <p className="mt-2 text-sm text-muted">The namespace, pod or node doesn’t exist (any more). Pods are replaced often, so a link to an old pod name can go stale.</p>
      <Link href="/" className="mt-5 inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">Back to overview</Link>
    </div>
  );
}
