import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface IndexEntry {
  name: string;
  manifestPath: string;
  lastOpenedAt: number;
}

interface IndexFile { workspaces: IndexEntry[] }

function isEntry(value: unknown): value is IndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string'
    && typeof row.manifestPath === 'string'
    && typeof row.lastOpenedAt === 'number';
}

/** Index là cache thuần: hỏng hay mất thì coi như rỗng, không bao giờ là nguồn sự thật. */
export class WorkspaceIndex {
  constructor(private readonly indexFilePath: string) {}

  async list(): Promise<IndexEntry[]> {
    const entries = await this.readRaw();
    return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async upsert(entry: IndexEntry): Promise<void> {
    const entries = (await this.readRaw()).filter((e) => !samePath(e.manifestPath, entry.manifestPath));
    entries.push(entry);
    await this.write(entries);
  }

  async remove(manifestPath: string): Promise<void> {
    const entries = (await this.readRaw()).filter((e) => !samePath(e.manifestPath, manifestPath));
    await this.write(entries);
  }

  async prune(exists: (manifestPath: string) => Promise<boolean>): Promise<IndexEntry[]> {
    const entries = await this.readRaw();
    const kept: IndexEntry[] = [];
    for (const entry of entries) {
      if (await exists(entry.manifestPath)) kept.push(entry);
    }
    await this.write(kept);
    return kept.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  private async readRaw(): Promise<IndexEntry[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.indexFilePath, 'utf8'));
      const list = (parsed as IndexFile | null)?.workspaces;
      return Array.isArray(list) ? list.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private async write(entries: IndexEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.indexFilePath), { recursive: true });
    await fs.writeFile(this.indexFilePath, `${JSON.stringify({ workspaces: entries }, null, 2)}\n`, 'utf8');
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
