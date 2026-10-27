import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import * as path from "node:path";

export async function readProjectFile(
  projectPath: string,
  filePath: string
): Promise<string> {
  const fullPath = path.join(projectPath, filePath);

  return readFile(fullPath, "utf-8");
}

export async function writeProjectFile(
  projectPath: string,
  filePath: string,
  content: string
): Promise<void> {
  const root = path.resolve(projectPath);
  const fullPath = path.resolve(root, filePath);

  if (!fullPath.startsWith(root + path.sep)) {
    throw new Error(`${filePath} is outside the project.`);
  }

  // Create missing folders (e.g. design/) instead of failing.
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

export async function listProjectFiles(
  projectPath: string
): Promise<string[]> {
  return readdir(projectPath);
}