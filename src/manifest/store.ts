import { promises as fs } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ManifestSchema, StateSchema, type Manifest, type WorkspaceState } from './schema';
import { manifestDir, manifestFilePath, stateFilePath } from './paths';

export class ManifestError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'ManifestError';
  }
}

// Factory thay vì hằng số dùng chung: mỗi lần gọi phải trả về một object MỚI, vì `sessions` sẽ bị
// mutate trực tiếp ở nơi gọi (WorkspaceManager.applyReport) — dùng chung một object sẽ khiến state
// của workspace này rò sang workspace khác mở sau đó.
const taoStateRong = (): WorkspaceState => ({ version: 1, sessions: {} });

export async function readManifest(projectRoot: string): Promise<Manifest> {
  const file = manifestFilePath(projectRoot);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new ManifestError(`Không đọc được manifest: ${file}`);
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    throw new ManifestError(`YAML sai cú pháp: ${file}`, [String(error)]);
  }

  const parsed = ManifestSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`);
    throw new ManifestError(`Manifest sai schema: ${file}`, issues);
  }
  return parsed.data;
}

export async function writeManifest(projectRoot: string, manifest: Manifest): Promise<void> {
  const dir = manifestDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(manifestFilePath(projectRoot), stringifyYaml(manifest), 'utf8');
  await fs.writeFile(
    `${dir}/.gitignore`,
    '# Trạng thái chạy, không commit\nstate.json\n',
    'utf8',
  );
}

export async function readState(projectRoot: string): Promise<WorkspaceState> {
  try {
    const raw = await fs.readFile(stateFilePath(projectRoot), 'utf8');
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : taoStateRong();
  } catch {
    return taoStateRong();
  }
}

export async function writeState(projectRoot: string, state: WorkspaceState): Promise<void> {
  await fs.mkdir(manifestDir(projectRoot), { recursive: true });
  await fs.writeFile(stateFilePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
