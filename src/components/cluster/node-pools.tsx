import Link from "next/link";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { NodePoolsResult } from "@/lib/do/node-pools-core";
import type { NodeView } from "@/lib/k8s/types";

/** Node pools and their autoscaling settings, read from the DigitalOcean API. */
export function NodePoolsSection({ result, nodes }: { result: NodePoolsResult; nodes: NodeView[] }) {
  if (result.state === "not-doks") return null;

  if (result.state === "no-token") {
    return (
      <Card>
        <CardBody className="flex items-start gap-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" />
          <div>
            <p className="font-medium">Node pool autoscaling isn’t shown yet</p>
            <p className="mt-1 text-xs text-muted">
              Autoscaling settings are stored in DigitalOcean, not in Kubernetes. To see them, create a read-only DigitalOcean API token (custom scope: Kubernetes, read)
              and connect it in <Link href="/settings" className="text-accent hover:underline">Settings</Link>. The token stays on this machine.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (result.state === "error") {
    return (
      <Card className="border-warning/40">
        <CardBody className="text-sm text-warning">Node pools unavailable: {result.message}</CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Node pools" subtitle="Read from the DigitalOcean API, so changes made in the DigitalOcean console appear here within about 30 seconds" />
      {result.pools.length === 0 ? (
        <CardBody className="text-sm text-muted">DigitalOcean reports no node pools for this cluster.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr><Th>Pool</Th><Th>Size</Th><Th>Nodes now</Th><Th>Autoscaling</Th><Th>Range</Th></tr>
            </thead>
            <tbody>
              {result.pools.map((pool) => {
                const joined = nodes.filter((n) => n.nodePool === pool.name).length;
                const settling = joined !== pool.count;
                return (
                  <tr key={pool.id || pool.name}>
                    <Td mono>{pool.name}</Td>
                    <Td mono>{pool.size}</Td>
                    <Td className="tabular-nums">
                      {pool.count}
                      {settling ? <span className="ml-2 text-xs text-warning" title="DigitalOcean and Kubernetes disagree while a node is being added or removed">{joined} in Kubernetes</span> : null}
                    </Td>
                    <Td>{pool.autoScale ? <Badge tone="success">On</Badge> : <Badge>Off · fixed size</Badge>}</Td>
                    <Td>
                      {pool.autoScale && pool.minNodes !== undefined && pool.maxNodes !== undefined ? (
                        <div className="w-56">
                          <p className="mb-1 text-xs tabular-nums text-muted">min {pool.minNodes} · max {pool.maxNodes} · now {pool.count}</p>
                          <Meter usage={pool.count} request={pool.minNodes} max={pool.maxNodes} height="h-1.5" label={`${pool.name} nodes`} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted">stays at {pool.count} {pool.count === 1 ? "node" : "nodes"}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
