import { createHash } from 'node:crypto';

export interface TrustMemory {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
}

export function fingerprintCommands(commands: string[]): string {
  // Băm biểu diễn JSON chứ không nối chuỗi: nối bằng một ký tự phân cách bất kỳ đều
  // có thể va chạm nếu chính nội dung lệnh chứa ký tự đó.
  return createHash('sha256').update(JSON.stringify(commands)).digest('hex');
}

function memoryKey(key: string): string {
  return `trust:${key.toLowerCase()}`;
}

export class TrustStore {
  constructor(private readonly memory: TrustMemory) {}

  isTrusted(key: string, commands: string[]): boolean {
    if (commands.length === 0) return true;
    return this.memory.get(memoryKey(key)) === fingerprintCommands(commands);
  }

  async trust(key: string, commands: string[]): Promise<void> {
    await this.memory.set(memoryKey(key), fingerprintCommands(commands));
  }
}
