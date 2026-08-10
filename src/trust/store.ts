import { createHash } from 'node:crypto';
import * as path from 'node:path';

export interface TrustMemory {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
}

export function fingerprintCommands(commands: string[]): string {
  // Băm biểu diễn JSON chứ không nối chuỗi: nối bằng một ký tự phân cách bất kỳ đều
  // có thể va chạm nếu chính nội dung lệnh chứa ký tự đó.
  return createHash('sha256').update(JSON.stringify(commands)).digest('hex');
}

function memoryKey(manifestPath: string): string {
  return `trust:${path.resolve(manifestPath).toLowerCase()}`;
}

export class TrustStore {
  constructor(private readonly memory: TrustMemory) {}

  isTrusted(manifestPath: string, commands: string[]): boolean {
    if (commands.length === 0) return true;
    return this.memory.get(memoryKey(manifestPath)) === fingerprintCommands(commands);
  }

  async trust(manifestPath: string, commands: string[]): Promise<void> {
    await this.memory.set(memoryKey(manifestPath), fingerprintCommands(commands));
  }
}
