import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/misc";
import type { ConnectionInfo } from "@/lib/k8s/types";

export function ClusterError({ connection, error }: { connection: ConnectionInfo; error: string }) {
  const saved = connection.clusterId?.startsWith("saved:");
  const none = !connection.clusterId;
  return (
    <Card className="mx-auto mt-10 max-w-2xl border-danger/40">
      <CardBody className="space-y-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <h1 className="text-base font-semibold">{none ? "No cluster connected" : "Can’t reach the cluster"}</h1>
            <p className="mt-1 break-words text-sm text-muted">{error}</p>
          </div>
        </div>
        {none ? null : (
          <KeyValue
            items={[
              { label: "Context", value: connection.contextName, mono: true },
              { label: "Cluster", value: connection.clusterName, mono: true },
              { label: "API server", value: connection.server, mono: true },
              { label: "User", value: connection.userName, mono: true },
            ]}
          />
        )}
        <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          <p className="mb-1 font-medium text-text">Things to check</p>
          <ul className="list-disc space-y-1 pl-4">
            {none ? (
              <li>Add a cluster in <Link href="/settings" className="text-accent hover:underline">Settings → Clusters</Link> with a read-only ServiceAccount token (<code className="font-mono text-text">deploy/read-only-rbac.yaml</code>).</li>
            ) : saved ? (
              <>
                <li>The cluster is running and its API server is reachable from the machine the dashboard runs on (private endpoints and authorised networks can block it).</li>
                <li>The token was not revoked: in <Link href="/settings" className="text-accent hover:underline">Settings → Clusters</Link>, remove it and add it again with a fresh token.</li>
              </>
            ) : (
              <>
                <li>Run <code className="font-mono text-text">kubectl --context {connection.contextName} get nodes</code> in a terminal. If that fails, fix it first (a local cluster may simply be stopped).</li>
                <li>For DigitalOcean, make sure <code className="font-mono text-text">doctl</code> is installed and logged in if your kubeconfig uses it.</li>
              </>
            )}
            {none ? null : <li>Pick another cluster from the switcher in the top bar.</li>}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}
