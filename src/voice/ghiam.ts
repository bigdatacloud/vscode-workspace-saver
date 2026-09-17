/**
 * Ghi âm micro bằng helper PowerShell + WinMM (`media/ghi-am.ps1`). Windows-only.
 *
 * Giao thức với helper cố ý mỏng: nó in "READY" khi đã ghi, đọc MỘT dòng stdin để dừng, in
 * "DONE <bytes> <peak>" khi đã ghi file. `peak` (0..32767) là đỉnh biên độ — dùng để phân biệt
 * "micro câm" với "không ai nói", hai chuyện có cách gỡ khác nhau.
 *
 * Không import vscode: chạy trong extension host nhưng test được bằng cách chỉ vào script khác.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface KetQuaGhiAm {
  wav: Uint8Array;
  giay: number;
  /** Đỉnh biên độ 0..32767. Dưới ~200 gần như chắc là micro câm hoặc chọn sai thiết bị. */
  peak: number;
}

const HAN_SAN_SANG_MS = 8_000;
const HAN_DUNG_MS = 10_000;

export class MayGhiAm {
  private tienTrinh: ChildProcess | null = null;
  private duongDanWav = '';
  private doiDone: Promise<{ bytes: number; peak: number }> | null = null;
  private batDauLuc = 0;

  constructor(private readonly duongDanScript: string) {}

  static hoTro(platform: NodeJS.Platform = process.platform): boolean {
    return platform === 'win32';
  }

  get dangGhi(): boolean {
    return this.tienTrinh !== null;
  }

  /** Bật micro; trả về khi helper báo READY (thường ~1,5 s) hoặc ném khi không mở được micro. */
  async batDau(): Promise<void> {
    if (this.tienTrinh !== null) throw new Error('Đang ghi rồi.');
    this.duongDanWav = join(tmpdir(), `ai-workspace-giong-noi-${Date.now()}.wav`);
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.duongDanScript, this.duongDanWav],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.tienTrinh = p;
    let stdout = '';
    let stderr = '';
    p.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    const sanSang = new Promise<void>((resolve, reject) => {
      const han = setTimeout(() => reject(new Error(`Helper ghi âm không sẵn sàng sau ${HAN_SAN_SANG_MS / 1000} s. ${stderr.trim()}`)), HAN_SAN_SANG_MS);
      p.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
        if (stdout.includes('READY')) {
          clearTimeout(han);
          resolve();
        }
      });
      p.on('exit', (code) => {
        clearTimeout(han);
        reject(new Error(`Helper ghi âm thoát sớm (mã ${code ?? '?'}). ${stderr.trim()}`));
      });
      p.on('error', (e) => {
        clearTimeout(han);
        reject(e);
      });
    });
    this.doiDone = new Promise((resolve, reject) => {
      p.on('exit', (code) => {
        const m = /DONE (\d+) (\d+)/.exec(stdout);
        if (m !== null) resolve({ bytes: Number(m[1]), peak: Number(m[2]) });
        else reject(new Error(`Helper ghi âm không báo DONE (mã ${code ?? '?'}). ${stderr.trim()}`));
      });
    });
    // Không để promise DONE rơi vào "unhandled" nếu bên gọi bỏ dở giữa chừng.
    this.doiDone.catch(() => undefined);
    await sanSang;
    this.batDauLuc = Date.now();
  }

  /** Dừng, đọc WAV, xoá file tạm. */
  async dung(): Promise<KetQuaGhiAm> {
    const p = this.tienTrinh;
    const doi = this.doiDone;
    if (p === null || doi === null) throw new Error('Chưa ghi.');
    this.tienTrinh = null;
    this.doiDone = null;
    p.stdin?.write('stop\n');
    const han = new Promise<never>((_, reject) =>
      setTimeout(() => {
        p.kill();
        reject(new Error(`Helper ghi âm không dừng sau ${HAN_DUNG_MS / 1000} s.`));
      }, HAN_DUNG_MS),
    );
    const { peak } = await Promise.race([doi, han]);
    const wav = await readFile(this.duongDanWav);
    void unlink(this.duongDanWav).catch(() => undefined);
    return { wav: new Uint8Array(wav), giay: (Date.now() - this.batDauLuc) / 1000, peak };
  }

  huy(): void {
    const p = this.tienTrinh;
    this.tienTrinh = null;
    this.doiDone = null;
    if (p !== null) {
      p.stdin?.write('stop\n');
      setTimeout(() => p.kill(), 2_000).unref();
    }
    void unlink(this.duongDanWav).catch(() => undefined);
  }
}
