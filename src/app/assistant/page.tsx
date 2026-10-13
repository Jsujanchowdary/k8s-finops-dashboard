import { Chat, type AssistantStatus } from "@/components/assistant/chat";
import { aiConfig } from "@/lib/ai/config";

export const metadata = { title: "AI assistant" };
// The key and the on/off switch are read from the environment when the page is requested, not when it is built.
export const dynamic = "force-dynamic";

export default function AssistantPage() {
  const config = aiConfig();
  const status: AssistantStatus = !config.enabled ? "off" : config.apiKey ? "ready" : "no-key";
  return <Chat status={status} model={config.model} />;
}
