import { Lock } from "lucide-react";
import { ClustersForm } from "@/components/settings/clusters-form";
import { SettingsForm } from "@/components/settings/settings-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { aiConfig } from "@/lib/ai/config";
import { selectedCluster } from "@/lib/clusters/registry";
import { loadCluster } from "@/lib/data";
import { refreshOptions } from "@/lib/refresh";
import { settingsStatus } from "@/lib/settings/store";

export const metadata = { title: "Settings" };
// Always the current values: they can change from this page.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [{ connection }, selected] = await Promise.all([loadCluster(), selectedCluster()]);
  const settings = settingsStatus();
  const ai = aiConfig();
  const current = Number(settings.find((s) => s.key === "NEXT_PUBLIC_REFRESH_SECONDS")?.shown ?? "30");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        crumbs={[{ label: "Overview", href: "/" }, { label: "Settings" }]}
        title="Settings"
        subtitle="Connect clusters from any cloud, DigitalOcean billing and Google Gemini. Everything is checked before it is saved on this machine, and takes effect at once."
      />

      <Card>
        <CardBody className="flex items-start gap-3 text-xs text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            Secrets stay on this machine: API keys are saved in <span className="font-mono text-text">.env.local</span> and cluster tokens in <span className="font-mono text-text">.dashboard/clusters.json</span> (both readable only by your user, and ignored by git), and never sent back to the browser. After saving you see only the last four characters. Settings can only be changed from this computer.
          </p>
        </CardBody>
      </Card>

      <ClustersForm initial={selected?.all ?? []} selected={selected?.summary.id} />

      <Card>
        <CardHeader title="Showing now" subtitle="The cluster this browser is looking at." />
        <CardBody>
          <KeyValue
            columns={2}
            items={[
              { label: "Status", value: connection.reachable ? "Connected" : `Not reachable${connection.error ? `: ${connection.error}` : ""}` },
              { label: "Cluster", value: connection.clusterName, mono: true },
              { label: "Context", value: connection.contextName || "—", mono: true },
              { label: "User", value: connection.userName || "—", mono: true },
              { label: "API server", value: connection.server || "—", mono: true, wide: true },
            ]}
          />
        </CardBody>
      </Card>

      <SettingsForm initial={settings} refreshPresets={refreshOptions(current)} aiModel={ai.model} aiEnabled={ai.enabled} />
    </div>
  );
}
