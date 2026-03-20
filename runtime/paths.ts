import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ProjectPaths {
  projectRoot: string;
  distRoot: string;
  skillsRoot: string;
  runsRoot: string;
  meshRoot: string;
  meshRunsRoot: string;
  profilesRoot: string;
}

function findProjectRoot(startDirectory: string): string {
  let current = resolve(startDirectory);

  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find package.json above ${startDirectory}`);
    }

    current = parent;
  }
}

export function getProjectPaths(): ProjectPaths {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = findProjectRoot(moduleDirectory);
  const meshRoot = join(projectRoot, ".trademesh");

  return {
    projectRoot,
    distRoot: join(projectRoot, "dist"),
    skillsRoot: join(projectRoot, "skills"),
    runsRoot: join(projectRoot, "runs"),
    meshRoot,
    meshRunsRoot: join(meshRoot, "runs"),
    profilesRoot: join(projectRoot, "profiles"),
  };
}
