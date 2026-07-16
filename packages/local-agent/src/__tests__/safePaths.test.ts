import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScaffoldTarget, isPathInside, sanitizeProjectName } from "../commands/safePaths";

describe("safe path helpers", () => {
  it("accepts simple project names", () => {
    expect(sanitizeProjectName("dusk-counter-demo")).toBe("dusk-counter-demo");
  });

  it("rejects traversal-like project names", () => {
    expect(() => sanitizeProjectName("../oops")).toThrow();
    expect(() => sanitizeProjectName("demo..escape")).toThrow();
    expect(() => sanitizeProjectName("demo.")).toThrow();
    expect(() => sanitizeProjectName("CON")).toThrow();
    expect(() => sanitizeProjectName("lpt1.txt")).toThrow();
    expect(() => sanitizeProjectName("démø")).toThrow();
  });

  it("checks child containment", () => {
    const root = path.resolve("C:/tmp/studio");
    expect(isPathInside(root, path.resolve(root, "demo"))).toBe(true);
    expect(isPathInside(root, path.resolve("C:/tmp/other"))).toBe(false);
  });

  it("keeps default scaffold targets inside the workspace", () => {
    const root = path.resolve("C:/tmp/studio");
    expect(buildScaffoldTarget(root, "demo")).toBe(path.resolve(root, ".generated", "demo"));
    expect(buildScaffoldTarget(root, "demo", "tmp/qa")).toBe(path.resolve(root, "tmp/qa", "demo"));
    expect(() => buildScaffoldTarget(root, "demo", path.resolve("C:/tmp/other"))).toThrow("inside the Studio workspace");
    expect(() => buildScaffoldTarget(root, "demo", "C:drive-relative")).toThrow("normal local absolute path");
    expect(() => buildScaffoldTarget(root, "demo", "\\\\server\\share")).toThrow("normal local absolute path");
  });

  it("can constrain scaffolds to an additional configured project root", () => {
    const workspace = path.resolve("C:/tmp/studio");
    const projectRoot = path.resolve("C:/tmp/dusk-studio-projects");
    const options = {
      defaultParent: projectRoot,
      allowedRoots: [projectRoot],
      errorLabel: "the Studio workspace or configured project root"
    };

    expect(buildScaffoldTarget(workspace, "demo", undefined, options)).toBe(path.resolve(projectRoot, "demo"));
    expect(buildScaffoldTarget(workspace, "demo", "nested", options)).toBe(path.resolve(projectRoot, "nested", "demo"));
    expect(buildScaffoldTarget(workspace, "demo", path.resolve(workspace, "tmp/qa"), options)).toBe(path.resolve(workspace, "tmp/qa", "demo"));
    expect(() => buildScaffoldTarget(workspace, "demo", path.resolve("C:/tmp/other"), options)).toThrow("inside the Studio workspace or configured project root");
  });
});
