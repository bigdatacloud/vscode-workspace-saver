/**
 * QUAN-Transcribe 1.0 — nhận dạng tiếng Việt chạy TRÊN MÁY, qua một tiến trình Python thường trú.
 *
 * Vì sao phải là tiến trình riêng: model là gói Python (CTC trên EmbeddingGemma 2), không có bản
 * ONNX/GGUF chính thức nên Node không nạp thẳng được.
 *
 * Vì sao THƯỜNG TRÚ chứ không gọi một phát rồi thoát: `from_pretrained` nạp vài trăm MB trọng số
 * mỗi lần khởi động. Gọi một tiến trình mới cho mỗi câu nói nghĩa là chờ nạp model mỗi lần —
 * đúng cái đã làm đường Nemotron không dùng được trước khi có bước làm nóng. Nên tiến trình sống
 * tới khi đóng cửa sổ, nhận đường dẫn WAV qua stdin, trả JSON một dòng qua stdout.
 *
 * Không import vscode: lớp UI bọc nó lại.
 */

import { spawn, type ChildProcess } from 'node:child_process';

/** Id trong setting `aiWorkspace.voice.model`. */
export const MODEL_QUAN = 'quan';
export const REPO_QUAN = 'qnguyen3/QUAN-Transcribe-1.0';

export type DongQuan = { loai: 'ready' } | { loai: 'text'; text: string } | { loai: 'loi'; loi: string };

/**
 * Đọc một dòng tiến trình Python in ra. Trả `null` với MỌI thứ không phải ba dạng ta chờ —
 * Python in đủ thứ ra stdout (tiến độ tải, cảnh báo thư viện), và một dòng lạ không được phép
 * làm chết vòng đọc.
 */
export function docDongQuan(raw: string): DongQuan | null {
  const t = raw.trim();
  if (t === '' || !t.startsWith('{')) return null;
  let o: Record<string, unknown>;
  try {
    const p: unknown = JSON.parse(t);
    if (typeof p !== 'object' || p === null) return null;
    o = p as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.ready === true) return { loai: 'ready' };
  if (typeof o.text === 'string') return { loai: 'text', text: o.text.trim() };
  if (typeof o.error === 'string') return { loai: 'loi', loi: o.error };
  return null;
}

/** Lỗi này nghĩa là chưa cài gói, không phải chạy hỏng — hiện hướng dẫn cài thay vì vết lỗi Python. */
export function laThieuGoiQuan(stderr: string): boolean {
  return /ModuleNotFoundError|ImportError/.test(stderr);
}

/**
 * Hướng dẫn cài, có chủ ý nói trước cỡ tải. Kiểm 2026-10-14 qua Hugging Face API: repo
 * google/embeddinggemma-2 KHÔNG còn gated (tải config.json không cần token), nên hướng dẫn không
 * bắt nhận điều khoản rồi đăng nhập nữa — đó là việc vô ích và làm người dùng tưởng chưa login
 * thì không chạy được. License Gemma vẫn ràng buộc cách dùng, nên vẫn nêu.
 */
export function huongDanCaiQuan(python: string): string {
  return [
    `Chưa cài QUAN-Transcribe. Chạy trong terminal:`,
    `  ${python} -m pip install torch --index-url https://download.pytorch.org/whl/cpu`,
    `  ${python} -m pip install git+https://github.com/qnguyen3/QUAN-Transcribe`,
    `Lần chạy đầu tải khoảng 2 GB trọng số về máy: encoder nền google/embeddinggemma-2 (1,5 GB),`,
    `trọng số QUAN (0,4 GB) và từ điển 4-gram tiếng Việt (0,1 GB). Model theo license Gemma.`,
    `So sánh: Nemotron của VS Code chỉ 755 MB và không cần Python.`,
  ].join('\n');
}

export interface KetQuaQuan {
  text: string;
  /** Mili giây tính từ lúc gửi đường dẫn tới lúc có chữ — để báo lại cho người dùng. */
  ms: number;
}

const HAN_NAP_MS = 300_000;
const HAN_CHUYEN_AM_MS = 120_000;

/**
 * Tiến trình nhận dạng thường trú. Một thể hiện cho cả cửa sổ; `nap()` gọi lần đầu rồi thôi.
 */
export class MayQuan {
  private tienTrinh: ChildProcess | null = null;
  private dem = '';
  private stderr = '';
  private sanSang = false;
  /** Hàng chờ: mỗi lần chuyển âm là một lời hứa, trả theo đúng thứ tự tiến trình in ra. */
  private readonly dangCho: { xong: (k: DongQuan) => void }[] = [];
  private napPromise: Promise<void> | null = null;

  constructor(
    private readonly python: string,
    private readonly duongDanScript: string,
    private readonly ghiLog: (d: string) => void = () => undefined,
  ) {}

  get daSanSang(): boolean {
    return this.sanSang;
  }

  get dangChay(): boolean {
    return this.tienTrinh !== null;
  }

  /** Khởi động tiến trình và chờ model nạp xong. Gọi nhiều lần chỉ nạp một lần. */
  nap(): Promise<void> {
    this.napPromise ??= this.napThat();
    return this.napPromise;
  }

  private napThat(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const p = spawn(this.python, ['-u', this.duongDanScript, REPO_QUAN], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.tienTrinh = p;
      const han = setTimeout(() => {
        this.dung();
        reject(new Error(`Nạp model QUAN quá ${HAN_NAP_MS / 1000} s mà chưa xong.`));
      }, HAN_NAP_MS);

      p.stderr?.on('data', (d: Buffer) => {
        this.stderr = `${this.stderr}${d.toString('utf8')}`.slice(-4000);
      });
      p.stdout?.setEncoding('utf8');
      p.stdout?.on('data', (d: string) => {
        this.dem += d;
        for (;;) {
          const i = this.dem.indexOf('\n');
          if (i === -1) break;
          const dong = this.dem.slice(0, i);
          this.dem = this.dem.slice(i + 1);
          const kq = docDongQuan(dong);
          if (kq === null) {
            if (dong.trim() !== '') this.ghiLog(`[quan] ${dong.trim().slice(0, 200)}`);
            continue;
          }
          if (kq.loai === 'ready') {
            clearTimeout(han);
            this.sanSang = true;
            resolve();
            continue;
          }
          this.dangCho.shift()?.xong(kq);
        }
      });
      p.on('error', (e) => {
        clearTimeout(han);
        this.tienTrinh = null;
        reject(e);
      });
      p.on('exit', (code) => {
        clearTimeout(han);
        this.tienTrinh = null;
        this.sanSang = false;
        const loi = laThieuGoiQuan(this.stderr)
          ? huongDanCaiQuan(this.python)
          : `Tiến trình QUAN thoát (mã ${code ?? '?'}). ${this.stderr.trim().slice(-500)}`;
        // Mọi lời hứa đang chờ phải được giải, không thì bên gọi treo vĩnh viễn.
        while (this.dangCho.length > 0) this.dangCho.shift()?.xong({ loai: 'loi', loi });
        reject(new Error(loi));
      });
    });
  }

  async chuyenAm(duongDanWav: string): Promise<KetQuaQuan> {
    await this.nap();
    const p = this.tienTrinh;
    if (p === null) throw new Error('Tiến trình QUAN không còn chạy.');
    const t0 = Date.now();
    const kq = await new Promise<DongQuan>((resolve) => {
      this.dangCho.push({ xong: resolve });
      p.stdin?.write(`${duongDanWav}\n`);
      setTimeout(() => resolve({ loai: 'loi', loi: `Chuyển âm quá ${HAN_CHUYEN_AM_MS / 1000} s.` }), HAN_CHUYEN_AM_MS);
    });
    if (kq.loai === 'loi') throw new Error(kq.loi);
    if (kq.loai !== 'text') throw new Error('Tiến trình QUAN trả về dòng lạ.');
    return { text: kq.text, ms: Date.now() - t0 };
  }

  dung(): void {
    const p = this.tienTrinh;
    this.tienTrinh = null;
    this.sanSang = false;
    this.napPromise = null;
    if (p !== null) {
      p.stdin?.end();
      setTimeout(() => p.kill(), 2_000).unref();
    }
  }
}
