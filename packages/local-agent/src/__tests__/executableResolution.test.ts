// @vitest-environment node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChildEnvironment } from "../commands/childEnvironment";
import {
  getLaunchPathExclusions,
  resolveExecutableForSpawn,
  resolveWindowsSystemExecutable,
  sanitizeExecutablePathEntries
} from "../commands/executableResolution";

const temporaryRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function windowsEnvironment(pathValue: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("Windows test requires SystemRoot.");
  return {
    SystemRoot: systemRoot,
    WINDIR: process.env.WINDIR ?? systemRoot,
    PATH: pathValue
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe("trusted executable resolution", () => {
  it("keeps only absolute non-project search directories outside the launch project", () => {
    const platform = process.platform === "win32" ? "win32" : "linux";
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const launchRoot = platform === "win32" ? "C:\\work\\untrusted" : "/work/untrusted";
    const trusted = platform === "win32" ? "C:\\tools\\bin" : "/tools/bin";
    const projectShim = pathApi.join(launchRoot, "node_modules", ".bin");
    const entries = [
      "",
      ".",
      "relative-bin",
      launchRoot,
      pathApi.join(launchRoot, "tools"),
      projectShim,
      trusted,
      `"${trusted}"`
    ];
    expect(sanitizeExecutablePathEntries(entries, {
      platform,
      excludedRoots: [launchRoot]
    })).toEqual([pathApi.normalize(trusted)]);
  });

  it("excludes a Windows launch directory reached through an 8.3 short-name alias", () => {
    const shortAlias = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\untrusted";
    const canonical = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\untrusted";
    expect(sanitizeExecutablePathEntries([shortAlias], {
      platform: "win32",
      excludedRoots: [canonical],
      realpath: (candidate) => candidate === shortAlias ? canonical : candidate
    })).toEqual([]);
  });

  it("excludes only the profile root when launched from home but excludes a nested project recursively", () => {
    const platform = process.platform === "win32" ? "win32" : "linux";
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const home = platform === "win32" ? "C:\\Users\\developer" : "/home/developer";
    const project = pathApi.join(home, "projects", "untrusted");
    expect(getLaunchPathExclusions(home, home, platform)).toEqual({
      excludedRoots: [],
      excludedPaths: [pathApi.normalize(home)]
    });
    expect(getLaunchPathExclusions(project, home, platform)).toEqual({
      excludedRoots: [pathApi.normalize(project)],
      excludedPaths: []
    });
  });

  it("ignores planted Windows helpers and uses only verified operating-system paths", async () => {
    if (process.platform !== "win32") return;
    const launchRoot = await makeTempRoot("dusk-planted-system-tools-");
    const planted = ["explorer.exe", "cmd.exe", "where.exe", "taskkill.exe", "wsl.exe"];
    await Promise.all(planted.map((name) => fsp.writeFile(path.join(launchRoot, name), "not an executable")));
    const environment = windowsEnvironment(launchRoot);

    for (const name of planted) {
      const resolved = resolveExecutableForSpawn(name, environment, {
        platform: "win32",
        inheritedCwd: launchRoot
      });
      const expected = resolveWindowsSystemExecutable(name, environment);
      expect(resolved.toLowerCase()).toBe(expected.toLowerCase());
      expect(path.dirname(resolved).toLowerCase()).not.toBe(launchRoot.toLowerCase());
    }
  });

  it("skips launch-directory, relative, and node_modules shims before selecting a native tool", async () => {
    if (process.platform !== "win32") return;
    const launchRoot = await makeTempRoot("dusk-planted-tool-");
    const projectShim = path.join(launchRoot, "node_modules", ".bin");
    const trustedBin = await makeTempRoot("dusk-trusted-tool-");
    await fsp.mkdir(projectShim, { recursive: true });
    await Promise.all([
      fsp.writeFile(path.join(launchRoot, "forge.exe"), "planted"),
      fsp.writeFile(path.join(projectShim, "forge.exe"), "shim")
    ]);
    const systemRoot = process.env.SystemRoot as string;
    await fsp.copyFile(
      path.join(systemRoot, "System32", "where.exe"),
      path.join(trustedBin, "forge.exe")
    );
    const poisonedPath = [
      launchRoot,
      "relative-bin",
      "",
      projectShim,
      trustedBin
    ].join(path.win32.delimiter);
    const resolved = resolveExecutableForSpawn("forge", windowsEnvironment(poisonedPath), {
      platform: "win32",
      inheritedCwd: launchRoot
    });
    expect(resolved.toLowerCase()).toBe(fs.realpathSync.native(path.join(trustedBin, "forge.exe")).toLowerCase());

    expect(() => resolveExecutableForSpawn(
      "cast",
      windowsEnvironment([launchRoot, "relative-bin", projectShim].join(path.win32.delimiter)),
      { platform: "win32", inheritedCwd: launchRoot }
    )).toThrow(/trusted search path/);
  });

  it("excludes the canonical launch project when the inherited cwd uses a junction alias", async () => {
    if (process.platform !== "win32") return;
    const canonicalLaunch = await makeTempRoot("dusk-canonical-launch-");
    const aliasParent = await makeTempRoot("dusk-launch-alias-parent-");
    const aliasLaunch = path.join(aliasParent, "launch-alias");
    await fsp.symlink(canonicalLaunch, aliasLaunch, "junction");
    const systemRoot = process.env.SystemRoot as string;
    await fsp.copyFile(
      path.join(systemRoot, "System32", "where.exe"),
      path.join(canonicalLaunch, "forge.exe")
    );
    const environment = createChildEnvironment(
      windowsEnvironment(canonicalLaunch),
      { inheritedCwd: aliasLaunch }
    );
    expect(environment.PATH).toBeUndefined();
    expect(() => resolveExecutableForSpawn("forge", windowsEnvironment(canonicalLaunch), {
      platform: "win32",
      inheritedCwd: aliasLaunch
    })).toThrow(/trusted search path/);
  });

  it("preserves reviewed and inherited per-user tool bins when launched from the user profile", async () => {
    if (process.platform !== "win32") return;
    const fakeHome = await makeTempRoot("dusk-home-launch-");
    const cargoBin = path.join(fakeHome, ".cargo", "bin");
    const userGitBin = path.join(fakeHome, "AppData", "Local", "Programs", "Git", "cmd");
    const projectShim = path.join(fakeHome, "node_modules", ".bin");
    await Promise.all([
      fsp.mkdir(cargoBin, { recursive: true }),
      fsp.mkdir(userGitBin, { recursive: true }),
      fsp.mkdir(projectShim, { recursive: true })
    ]);
    const systemRoot = process.env.SystemRoot as string;
    await Promise.all([
      fsp.copyFile(
        path.join(systemRoot, "System32", "where.exe"),
        path.join(cargoBin, "cargo.exe")
      ),
      fsp.copyFile(
        path.join(systemRoot, "System32", "where.exe"),
        path.join(userGitBin, "git.exe")
      ),
      fsp.writeFile(path.join(fakeHome, "cargo.exe"), "planted"),
      fsp.writeFile(path.join(projectShim, "cargo.exe"), "shim")
    ]);
    const environment = createChildEnvironment(
      windowsEnvironment([
        fakeHome,
        "relative-bin",
        projectShim,
        userGitBin,
        cargoBin
      ].join(path.win32.delimiter)),
      {
        trustedPathAdditions: [cargoBin],
        inheritedCwd: fakeHome,
        homeDirectory: fakeHome
      }
    );
    expect((environment.PATH ?? "").split(path.win32.delimiter).map((entry) => entry.toLowerCase()))
      .toEqual([
        path.normalize(cargoBin).toLowerCase(),
        path.normalize(userGitBin).toLowerCase()
      ]);
    expect(resolveExecutableForSpawn("cargo", environment, {
      platform: "win32",
      inheritedCwd: fakeHome,
      homeDirectory: fakeHome,
      trustedPathDirectories: [cargoBin]
    }).toLowerCase()).toBe(fs.realpathSync.native(path.join(cargoBin, "cargo.exe")).toLowerCase());
    expect(resolveExecutableForSpawn("git", environment, {
      platform: "win32",
      inheritedCwd: fakeHome,
      homeDirectory: fakeHome
    }).toLowerCase()).toBe(fs.realpathSync.native(path.join(userGitBin, "git.exe")).toLowerCase());
  });

  it("rejects absolute system-helper lookalikes and inconsistent Windows roots", async () => {
    if (process.platform !== "win32") return;
    const launchRoot = await makeTempRoot("dusk-helper-lookalike-");
    const lookalike = path.join(launchRoot, "cmd.exe");
    await fsp.writeFile(lookalike, "lookalike");
    const environment = windowsEnvironment(launchRoot);
    expect(() => resolveExecutableForSpawn(lookalike, environment, {
      platform: "win32",
      inheritedCwd: launchRoot
    })).toThrow(/operating-system path/);
    expect(() => resolveWindowsSystemExecutable("cmd.exe", {
      ...environment,
      WINDIR: "D:\\Windows"
    })).toThrow(/inconsistent/);
  });
});
