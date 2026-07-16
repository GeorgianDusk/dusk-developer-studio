import { createLocalAgentServer, type LocalAgentServerOptions } from "./server";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

function envFlag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function readEnvironmentOptions(): LocalAgentServerOptions {
  const extraAllowedOrigins = (process.env.DUSK_STUDIO_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    pairingToken: process.env.DUSK_STUDIO_PAIRING_TOKEN ?? "",
    port: Number(process.env.DUSK_STUDIO_AGENT_PORT ?? DEFAULT_PORT),
    workspaceRoot: process.env.DUSK_STUDIO_WORKSPACE_ROOT,
    foundryTemplateRoot: process.env.DUSK_STUDIO_FOUNDRY_TEMPLATE_ROOT,
    duskDsProjectRoot: process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT,
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...extraAllowedOrigins],
    capabilitiesEnabled: envFlag("DUSK_STUDIO_ENABLE_CAPABILITIES"),
    allowPrivateNetwork: envFlag("DUSK_STUDIO_ALLOW_PRIVATE_NETWORK")
  };
}

try {
  const options = readEnvironmentOptions();
  const server = createLocalAgentServer(options);
  const port = options.port ?? DEFAULT_PORT;
  server.listen(port, HOST, () => {
    console.log(`Dusk Studio local companion listening on http://${HOST}:${port}`);
    console.log(`Local capabilities: ${options.capabilitiesEnabled ? "enabled" : "disabled"}`);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not start the local companion.");
  process.exitCode = 1;
}
