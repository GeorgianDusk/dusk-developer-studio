import type { StudioArtifactChannel, StudioRelease } from "../release";
import type { CompanionRelease } from "./responseSchemas";

export type StudioRuntimeMode = "local-capable" | "hosted-guide";

export interface StudioRuntime {
  mode: StudioRuntimeMode;
  companionAvailable: boolean;
  label: "Local-capable" | "Hosted guide";
  channel: StudioArtifactChannel;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const FULL_COMMIT = /^[a-f0-9]{40}$/;

export function getStudioRuntime(hostname: string, channel: StudioArtifactChannel): StudioRuntime {
  const companionAvailable = channel === "npm" && LOOPBACK_HOSTS.has(hostname.toLowerCase());
  return companionAvailable
    ? { mode: "local-capable", companionAvailable: true, label: "Local-capable", channel }
    : { mode: "hosted-guide", companionAvailable: false, label: "Hosted guide", channel };
}

export function hasLocalReleaseParity(frontend: StudioRelease, companion: CompanionRelease | undefined): boolean {
  return frontend.channel === "npm"
    && FULL_COMMIT.test(frontend.commit)
    && companion?.product === frontend.product
    && companion.version === frontend.version
    && companion.commit === frontend.commit
    && companion.channel === "npm"
    && FULL_COMMIT.test(companion.commit);
}
