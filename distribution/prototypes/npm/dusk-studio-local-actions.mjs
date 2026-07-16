#!/usr/bin/env node
import { launch } from "./launch.mjs";

launch({ capabilitiesEnabled: true }).catch((error) => {
  console.error(error instanceof Error ? error.message : "Dusk Developer Studio Local could not start.");
  process.exitCode = 1;
});
