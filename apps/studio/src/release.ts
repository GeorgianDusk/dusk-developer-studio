declare const __DUSK_STUDIO_VERSION__: string;
declare const __DUSK_STUDIO_COMMIT__: string;
declare const __DUSK_STUDIO_ARTIFACT_CHANNEL__: string;

export const STUDIO_PRODUCT = "Dusk Developer Studio" as const;
export type StudioArtifactChannel = "hosted" | "portable" | "source-dev";

export interface StudioRelease {
  product: typeof STUDIO_PRODUCT;
  version: string;
  commit: string;
  channel: StudioArtifactChannel;
}

function parseArtifactChannel(value: string | undefined): StudioArtifactChannel {
  return value === "portable" || value === "source-dev" ? value : "hosted";
}

export const STUDIO_RELEASE = Object.freeze({
  product: STUDIO_PRODUCT,
  version: typeof __DUSK_STUDIO_VERSION__ === "undefined" ? "0.1.0-test" : __DUSK_STUDIO_VERSION__,
  commit: typeof __DUSK_STUDIO_COMMIT__ === "undefined" ? "test" : __DUSK_STUDIO_COMMIT__,
  channel: parseArtifactChannel(typeof __DUSK_STUDIO_ARTIFACT_CHANNEL__ === "undefined" ? undefined : __DUSK_STUDIO_ARTIFACT_CHANNEL__)
}) satisfies Readonly<StudioRelease>;

const releaseCommitLabel = STUDIO_RELEASE.commit.endsWith("-dirty") ? `${STUDIO_RELEASE.commit.slice(0, 8)}-dirty` : STUDIO_RELEASE.commit.slice(0, 8);
export const STUDIO_RELEASE_LABEL = `v${STUDIO_RELEASE.version} (${releaseCommitLabel})`;
