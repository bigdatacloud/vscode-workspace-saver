import * as path from 'node:path';

export const MANIFEST_DIR_NAME = '.ai-workspace';
export const MANIFEST_FILE_NAME = 'workspace.yaml';
export const STATE_FILE_NAME = 'state.json';

export function manifestDir(projectRoot: string): string {
  return path.join(projectRoot, MANIFEST_DIR_NAME);
}

export function manifestFilePath(projectRoot: string): string {
  return path.join(manifestDir(projectRoot), MANIFEST_FILE_NAME);
}

export function stateFilePath(projectRoot: string): string {
  return path.join(manifestDir(projectRoot), STATE_FILE_NAME);
}

/** `manifestFile` là <root>/.ai-workspace/workspace.yaml; `declaredRoot` là project.root trong manifest. */
export function resolveProjectRoot(manifestFile: string, declaredRoot: string): string {
  const anchor = path.dirname(path.dirname(path.resolve(manifestFile)));
  return path.resolve(anchor, declaredRoot);
}

export function resolveWorktreePath(projectRoot: string, storedPath: string): string {
  const native = storedPath.replace(/\//g, path.sep);
  return path.isAbsolute(native) ? path.resolve(native) : path.resolve(projectRoot, native);
}

/** Trả về dạng lưu trong manifest: tương đối so với projectRoot, dùng dấu `/`. */
export function toStoredPath(projectRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  if (rel === '' ) return '.';
  if (path.isAbsolute(rel)) return path.resolve(absolutePath).replace(/\\/g, '/');
  return rel.replace(/\\/g, '/');
}
