import fs from "node:fs/promises";
import path from "node:path";

export interface ProjectStructureEvidence {
  files: string[];
  structureVerified: boolean;
}

export async function collectProjectStructureEvidence(target: string, requiredFiles: string[], maximumFiles = 256): Promise<ProjectStructureEvidence> {
  const root = path.resolve(target);
  const files: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 24) throw new Error("Project evidence exceeded its directory-depth limit.");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const entryPath = path.join(directory, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error("Project evidence cannot follow symlinks or junctions.");
      if (stat.isDirectory()) await visit(entryPath, depth + 1);
      else if (stat.isFile()) {
        files.push(path.relative(root, entryPath).split(path.sep).join("/"));
        if (files.length > maximumFiles) throw new Error("Project evidence exceeded its file limit.");
      } else throw new Error("Project evidence found an unsupported filesystem entry.");
    }
  }

  await visit(root, 0);
  files.sort();
  return { files, structureVerified: requiredFiles.every((required) => files.includes(required)) };
}
