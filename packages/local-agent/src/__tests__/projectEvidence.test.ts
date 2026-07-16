// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectStructureEvidence } from "../commands/projectEvidence";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("bounded project structure evidence", () => {
  it("returns relative filenames and verifies required structure without file contents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-evidence-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "Cargo.toml"), "secret-content");
    await fs.writeFile(path.join(root, "src", "lib.rs"), "private-key-like-content");
    const result = await collectProjectStructureEvidence(root, ["Cargo.toml", "src/lib.rs"]);
    expect(result).toEqual({ files: ["Cargo.toml", "src/lib.rs"], structureVerified: true });
    expect(JSON.stringify(result)).not.toContain("secret-content");
  });
});
