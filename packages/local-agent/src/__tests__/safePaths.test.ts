import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildScaffoldTarget,
  isPathInside,
  MAX_SCAFFOLD_PATH_LENGTH,
  sanitizeProjectName,
  ScaffoldPathError
} from "../commands/safePaths";

describe("safe path helpers", () => {
  it("accepts simple project names", () => {
    expect(sanitizeProjectName("dusk-counter-demo")).toBe("dusk-counter-demo");
  });

  it("rejects traversal-like project names", () => {
    expect(() => sanitizeProjectName("../oops")).toThrow();
    expect(() => sanitizeProjectName("demo..escape")).toThrow();
    expect(() => sanitizeProjectName("demo.")).toThrow();
    expect(() => sanitizeProjectName(" demo")).toThrow();
    expect(() => sanitizeProjectName("demo ")).toThrow();
    expect(() => sanitizeProjectName("CON")).toThrow();
    expect(() => sanitizeProjectName("lpt1.txt")).toThrow();
    expect(() => sanitizeProjectName("démø")).toThrow();
  });

  it.each(["Native", "1demo", "demo_name", "demo.name", "demo-", "demo--name"])(
    "matches Forge's exact project-name grammar and rejects %s",
    (name) => expect(() => sanitizeProjectName(name)).toThrow()
  );

  it.each(["type", "mod", "self", "crate", "super", "async", "await", "gen", "yield", "union", "macro-rules"])(
    "rejects the Rust 2024 keyword or reserved project name %s",
    (name) => expect(() => sanitizeProjectName(name)).toThrow("Rust 2024 keyword")
  );

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

  it("constrains a custom default to the configured project root", () => {
    const workspace = path.resolve("C:/tmp/studio");
    const projectRoot = path.resolve("C:/tmp/dusk-studio-projects");
    const options = {
      defaultParent: projectRoot,
      allowedRoots: [projectRoot],
      errorLabel: "the configured project root"
    };

    expect(buildScaffoldTarget(workspace, "demo", undefined, options)).toBe(path.resolve(projectRoot, "demo"));
    expect(buildScaffoldTarget(workspace, "demo", "nested", options)).toBe(path.resolve(projectRoot, "nested", "demo"));
    expect(() => buildScaffoldTarget(workspace, "demo", path.resolve(workspace, "tmp/qa"), options)).toThrow("inside the configured project root");
    try {
      buildScaffoldTarget(workspace, "demo", path.resolve("C:/tmp/other"), options);
      throw new Error("Expected containment to reject the parent.");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaffoldPathError);
      expect(error).toMatchObject({ code: "scaffold_parent_outside_root" });
    }
  });

  it.each(["nested\rchild", "nested\nchild"])(
    "rejects parent controls before path planning for %j",
    (parent) => {
      const root = path.resolve("C:/tmp/studio");
      expect(() => buildScaffoldTarget(root, "demo", parent)).toThrow("normal local absolute path");
    }
  );

  it("bounds configured roots, parent folders, and response targets consistently", () => {
    const workspace = path.resolve("C:/tmp/studio");
    const overlong = path.resolve(workspace, "a".repeat(MAX_SCAFFOLD_PATH_LENGTH + 1));
    expect(() => buildScaffoldTarget(workspace, "demo", undefined, {
      defaultParent: overlong,
      allowedRoots: [overlong]
    })).toThrow("1,024 characters or fewer");
    expect(() => buildScaffoldTarget(workspace, "demo", "a".repeat(MAX_SCAFFOLD_PATH_LENGTH + 1)))
      .toThrow("1,024 characters or fewer");
  });
});
