#!/usr/bin/env node
import { reportLaunchError, runCli } from "./launch.mjs";

runCli(process.argv.slice(2)).catch(reportLaunchError);
