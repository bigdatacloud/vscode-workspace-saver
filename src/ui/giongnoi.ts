import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { gopVeMotDong } from '../orch/bus';
import {
  CAC_MODEL,
  docKetQuaGemini,
  docKetQuaOpenAI,
  dungYeuCauGemini,
  dungYeuCauOpenAI,
  lamSachLoi,
  timModel,
  type ModelSTT,
  type NhaCungCap,
} from '../voice/cloud';
import { MayGhiAm } from '../voice/ghiam';
import { huongDanCaiQuan, MayQuan, MODEL_QUAN } from '../voice/quan';
import { canBatWordWrap } from '../voice/wrap';

/**
 * Bật/tắt nghe giọng nói vào terminal đang hoạt động, kèm chỉ báo "đang nghe" — cùng nhịp tay với
 * Orca: một phím bật, nói, cùng phím đó dừng.
 *
 * Extension KHÔNG tự nhận dạng giọng nói. Nó dùng dictation tích hợp của VS Code (model Nemotron
 * chạy offline, có tiếng Việt) — qua đường EDITOR: mở một tài liệu nháp, cho VS Code gõ vào đó,
 * dừng thì đọc lại rồi TỰ đưa vào terminal. Chọn đường này thay vì `terminal.startVoice` vì ba
 * lý do: giữ nguyên dấu câu (đường terminal của VS Code cố ý bỏ dấu câu cho dòng lệnh, không hợp
 * với prompt cho agent); người dùng THẤY chữ đang hiện dần trong tab nháp — kể cả dòng "đang nạp
 * model" — nên biết lúc nào nói được; và ta cầm được chữ để báo lại. Cả hai đường đều được đo
 * bằng micro giả của Chromium (2026-09-17, test `giongnoi-thinghiem`) và đều ra chữ khi chờ
 * đủ thời gian nạp model.
 *
 * Đường CLOUD (OpenAI / Gemini): extension tự ghi âm bằng helper PowerShell + WinMM
 * (`media/ghi-am.ps1`, Windows-only), dừng thì gửi WAV lên API rồi đưa chữ vào terminal. Không có
 * bước nạp model nên bấm là nói được; đổi lại mất 1–3 giây sau khi dừng, cần API key (giữ trong
 * SecretStorage), và âm thanh rời máy. Người dùng chọn đường nào ở bảng chọn lúc bấm phím.
 *
 * Enter vẫn là của người dùng — tự gửi một câu nghe nhầm vào agent là chuyện không được phép.
 */

const LENH_BAT = 'workbench.action.editorDictation.start';
const LENH_DUNG = 'workbench.action.editorDictation.stop';
const KHOA_NGU_CANH = 'aiWorkspace.dangNghe';
export const LENH_TOGGLE = 'aiWorkspace.voiceToggle';
export const LENH_CHON_MIC = 'aiWorkspace.voiceSelectMicrophone';
/** Lệnh chọn micro của chính VS Code cho dictation — ghi nhớ theo cửa sổ, không có setting tương ứng. */
const LENH_CHON_MIC_VSCODE = 'workbench.action.chat.selectSpeechToTextMicrophone';
const PHIM = process.platform === 'darwin' ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y';
/** Sau lệnh dừng, VS Code còn chuyển âm nốt đoạn cuối rồi mới gõ — chờ tới khi chữ đứng yên. */
const CHO_ON_DINH_MS = 1_200;
const CHO_TOI_DA_MS = 8_000;
/**
 * Thời gian giữ phiên làm nóng. Đo trên máy thật (CPU, model 755 MB): 30 s ra nửa câu, 45 s ra
 * trọn câu — model nạp xong đâu đó trong khoảng ấy. Quá thời gian này model đã ở trong RAM của
 * tiến trình local-transcription và ở lại đó tới khi đóng cửa sổ; các lần nghe sau ra chữ ngay.
 */
const LAM_NONG_MS = 40_000;
const KHOA_CAI_DAT_LAM_NONG = 'aiWorkspace.voice.warmUpOnStartup';
const KHOA_CAI_DAT_MODEL = 'aiWorkspace.voice.model';
const KHOA_CAI_DAT_HOI = 'aiWorkspace.voice.askOnStart';
const KHOA_CAI_DAT_NGON_NGU = 'aiWorkspace.voice.language';
export const LENH_DAT_KEY = 'aiWorkspace.voiceSetApiKey';
/** Nhà cung cấp cần API key — QUAN và Nemotron chạy trên máy nên không có mặt ở đây. */
type NhaCloud = 'openai' | 'gemini';
const TEN_SECRET: Record<NhaCloud, string> = {
  openai: 'aiWorkspace.voice.openaiApiKey',
  gemini: 'aiWorkspace.voice.geminiApiKey',
};
const KHOA_CAI_DAT_PYTHON = 'aiWorkspace.voice.quanPython';
const HAN_GOI_API_MS = 60_000;

interface PhienCloud {
  terminal: vscode.Terminal;
  model: ModelSTT;
  may: MayGhiAm;
}

interface PhienNghe {
  terminal: vscode.Terminal;
  nhap: vscode.TextDocument;
  /** Phiên chỉ để nạp model — không có đích, không đưa chữ đi đâu; bấm phím lúc này thì "nhập" vào nó. */
  lamNong: boolean;
}

export class BoNgheGiongNoi implements vscode.Disposable {
  private phien: PhienNghe | null = null;
  private dangDung = false;
  /** Model đã có trong RAM của cửa sổ này chưa — quyết định dòng nhắc "nói ngay" hay "chờ nạp". */
  private modelNong = false;
  private readonly thanh: vscode.StatusBarItem;
  /** Đóng thông báo tiến trình khi dừng — nó là promise treo cho tới lúc ta gọi. */
  private dongThongBao: (() => void) | null = null;
  /** Kênh chẩn đoán: mỗi bước một dòng, để "nghe xong không ra chữ" truy được thay vì đoán. */
  private readonly kenh = vscode.window.createOutputChannel('AI Workspace — Giọng nói');
  private phienCloud: PhienCloud | null = null;
  /** Tiến trình nhận dạng QUAN — nạp một lần rồi giữ sống tới khi đóng cửa sổ. */
  private mayQuan: MayQuan | null = null;

  private ghi(dong: string): void {
    const d = `[${new Date().toLocaleTimeString('vi-VN')}] ${dong}`;
    this.kenh.appendLine(d);
    if (process.env.AI_WORKSPACE_THI_NGHIEM_GIONG_NOI === '1') console.log(`[giongnoi] ${d}`);
  }

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly duongDanExtension: string,
  ) {
    // Ưu tiên rất cao để đứng sát mép trái: lúc đang nghe, đây là thứ duy nhất cần thấy.
    this.thanh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10_000);
    this.thanh.command = LENH_TOGGLE;
    this.thanh.tooltip = `Đang nghe giọng nói. Bấm ${PHIM} hoặc bấm vào đây để dừng và đưa chữ vào terminal. Nói mà không ra chữ → lệnh "AI Workspace: Chọn micro nghe giọng nói".`;
    this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  async toggle(): Promise<void> {
    if (this.phienCloud !== null) {
      await this.dungCloud();
      return;
    }
    if (this.phien !== null && !this.phien.lamNong) {
      await this.dung();
      return;
    }
    // `activeTerminal` là terminal hoạt động GẦN NHẤT, kể cả khi focus đang ở cây hay editor —
    // nên bấm phím từ cây AI Workspaces vẫn nghe vào đúng terminal vừa chọn.
    const terminal = vscode.window.activeTerminal;
    if (terminal === undefined) {
      void vscode.window.showWarningMessage(
        'Chưa có terminal nào đang mở để nghe. Bấm vào một terminal trong cây AI Workspaces trước.',
      );
      return;
    }
    const model = await this.chonModel();
    if (model === null) return;
    if (model.nha === 'quan' || model.nha === 'openai' || model.nha === 'gemini') {
      // Cả ba đều: extension tự ghi âm → dừng → chuyển âm. Khác nhau ở bước chuyển âm thôi.
      await this.batCloud(terminal, model);
      return;
    }
    if (this.phien !== null && this.phien.lamNong) {
      // Đang làm nóng mà người dùng bấm: KHÔNG dừng rồi bật lại (mất thêm một vòng), mà nhận
      // luôn phiên đó làm phiên thật. Chữ nhặt được lúc làm nóng (tiếng nền) thì xoá đi.
      this.phien = { ...this.phien, terminal, lamNong: false };
      await this.xoaNoiDung(this.phien.nhap);
      this.ghi(`bấm trong lúc làm nóng → nhận phiên làm nóng làm phiên thật, đích "${terminal.name}"`);
      this.hienDangNghe(terminal);
      return;
    }
    const nhap = await this.batDictation(terminal.name);
    if (nhap === null) {
      terminal.show(false);
      return;
    }
    this.phien = { terminal, nhap, lamNong: false };
    this.hienDangNghe(terminal);
  }

  // ------------------------------------------------------------ bảng chọn

  private get cauHinh(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration();
  }

  /**
   * Bảng chọn local/cloud + model. Mặc định (đã lưu) được chọn sẵn nên Enter là đi ngay; chọn
   * mục khác thì dùng luôn VÀ lưu làm mặc định — không có bước "đặt mặc định" riêng, vì cái người
   * ta vừa chọn chính là cái họ muốn lần sau. Tắt hỏi bằng mục cuối hoặc setting.
   */
  private async chonModel(): Promise<ModelSTT | null> {
    const macDinh = timModel(this.cauHinh.get<string>(KHOA_CAI_DAT_MODEL));
    if (this.cauHinh.get<boolean>(KHOA_CAI_DAT_HOI, true) !== true) return macDinh;

    type Muc = vscode.QuickPickItem & { model?: ModelSTT; hanhDong?: 'khongHoi' | 'key' | 'phim' | 'mic' };
    const muc: Muc[] = [];
    let nhaTruoc: NhaCungCap | null = null;
    for (const m of CAC_MODEL) {
      if (m.nha !== nhaTruoc) {
        const tieuDe =
          m.nha === 'quan' ? 'Trên máy — tiếng Việt' : m.nha === 'local' ? 'Trên máy — đa ngôn ngữ' : m.nha === 'openai' ? 'OpenAI' : 'Google Gemini';
        muc.push({ label: tieuDe, kind: vscode.QuickPickItemKind.Separator });
        nhaTruoc = m.nha;
      }
      const laCloud = m.nha === 'openai' || m.nha === 'gemini';
      const coKey = laCloud ? (await this.layKey(m.nha as NhaCloud)) !== null : true;
      const canGhiAm = laCloud || m.nha === 'quan';
      const ghiChu = [
        laCloud && !coKey ? 'CHƯA có API key (chọn sẽ hỏi key)' : '',
        canGhiAm && !MayGhiAm.hoTro() ? 'cần helper ghi âm, hiện chỉ có trên Windows' : '',
        m.nha === 'quan' && this.mayQuan?.daSanSang === true ? 'model đã nạp, nói là ăn ngay' : '',
      ].filter((x) => x !== '');
      muc.push({
        label: `${m.id === macDinh.id ? '$(check) ' : '$(circle-large-outline) '}${m.ten}`,
        description: m.id === macDinh.id ? 'mặc định' : '',
        detail: `${m.moTa}${ghiChu.length === 0 ? '' : ` — ${ghiChu.join('; ')}`}`,
        model: m,
      });
    }
    muc.push({ label: 'Khác', kind: vscode.QuickPickItemKind.Separator });
    muc.push({ label: '$(key) Nhập / đổi API key…', hanhDong: 'key' });
    muc.push({ label: '$(mic) Chọn micro cho đường local…', hanhDong: 'mic' });
    muc.push({ label: '$(keyboard) Đổi phím tắt…', description: PHIM, hanhDong: 'phim' });
    muc.push({ label: '$(eye-closed) Không hỏi nữa — bấm phím là dùng mặc định ngay', detail: `Bật lại bằng setting ${KHOA_CAI_DAT_HOI}`, hanhDong: 'khongHoi' });

    const chon = await vscode.window.showQuickPick(muc, {
      placeHolder: `Nghe giọng nói bằng gì? Enter = ${macDinh.ten}. Chọn mục khác là dùng luôn và lưu làm mặc định.`,
      matchOnDetail: true,
    });
    if (chon === undefined) return null;
    if (chon.hanhDong === 'khongHoi') {
      await this.cauHinh.update(KHOA_CAI_DAT_HOI, false, vscode.ConfigurationTarget.Global);
      return macDinh;
    }
    if (chon.hanhDong === 'key') {
      await this.nhapKey();
      return this.chonModel();
    }
    if (chon.hanhDong === 'mic') {
      await this.chonMic();
      return this.chonModel();
    }
    if (chon.hanhDong === 'phim') {
      await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', LENH_TOGGLE);
      return null;
    }
    const m = chon.model as ModelSTT;
    if (m.id !== macDinh.id) await this.cauHinh.update(KHOA_CAI_DAT_MODEL, m.id, vscode.ConfigurationTarget.Global);
    return m;
  }

  private async layKey(nha: NhaCloud): Promise<string | null> {
    const tuSecret = await this.secrets.get(TEN_SECRET[nha]);
    if (tuSecret !== undefined && tuSecret.trim() !== '') return tuSecret.trim();
    // Biến môi trường là đường tắt cho người đã có key trong shell — nhưng chỉ khi extension host
    // thừa kế được nó.
    const env = nha === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
    return env !== undefined && env.trim() !== '' ? env.trim() : null;
  }

  /** Hỏi nhà cung cấp rồi key; key vào SecretStorage (mã hoá bởi hệ điều hành), không vào settings. */
  async nhapKey(nhaChon?: NhaCloud): Promise<boolean> {
    let nha = nhaChon;
    if (nha === undefined) {
      const c = await vscode.window.showQuickPick(
        [
          { label: 'OpenAI', description: 'sk-…', nha: 'openai' as const },
          { label: 'Google Gemini', description: 'AIza…', nha: 'gemini' as const },
        ],
        { placeHolder: 'Nhập API key cho nhà cung cấp nào?' },
      );
      if (c === undefined) return false;
      nha = c.nha;
    }
    const key = await vscode.window.showInputBox({
      prompt: `API key ${nha === 'openai' ? 'OpenAI' : 'Gemini'} — được giữ trong kho bí mật của VS Code, không ghi vào settings. Để trống và Enter để xoá key đã lưu.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) return false;
    if (key.trim() === '') {
      await this.secrets.delete(TEN_SECRET[nha]);
      void vscode.window.showInformationMessage(`Đã xoá API key ${nha}.`);
      return false;
    }
    await this.secrets.store(TEN_SECRET[nha], key.trim());
    void vscode.window.showInformationMessage(`Đã lưu API key ${nha}.`);
    return true;
  }

  // --------------------------------------- đường TỰ GHI ÂM (QUAN + cloud)

  /**
   * Bật ghi âm cho các model mà extension tự cầm âm thanh: QUAN (chuyển âm bằng tiến trình
   * Python trên máy) và cloud (gửi lên dịch vụ). Khác đường Nemotron ở chỗ không có tab nháp —
   * VS Code không tham gia, nên bấm là ghi ngay.
   */
  private async batCloud(terminal: vscode.Terminal, model: ModelSTT): Promise<void> {
    if (!MayGhiAm.hoTro()) {
      void vscode.window.showWarningMessage(
        'Đường này cần helper ghi âm WinMM, hiện chỉ có trên Windows. Chọn model "Local — Nemotron" để dùng dictation của VS Code.',
      );
      return;
    }
    if (model.nha === 'quan') {
      // Nạp model TRƯỚC khi mở micro: nạp mất hàng chục giây, mà micro sáng trong lúc chờ là
      // vừa khó hiểu vừa ghi thừa một đoạn im lặng dài.
      const san = await this.chuanBiQuan();
      if (!san) return;
    } else {
      const nha = model.nha as NhaCloud;
      const key = await this.layKey(nha);
      if (key === null) {
        const co = await this.nhapKey(nha);
        if (!co) return;
        if ((await this.layKey(nha)) === null) return;
      }
    }
    const may = new MayGhiAm(path.join(this.duongDanExtension, 'media', 'ghi-am.ps1'));
    this.ghi(`cloud ${model.id}: bật ghi âm cho "${terminal.name}"`);
    try {
      await may.batDau();
    } catch (e) {
      this.ghi(`ghi âm không bật được: ${e instanceof Error ? e.message : String(e)}`);
      void vscode.window.showWarningMessage(`Không bật được ghi âm: ${lamSachLoi(e instanceof Error ? e.message : String(e))}`);
      return;
    }
    this.phienCloud = { terminal, model, may };
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, true);
    this.thanh.text = `$(record) ĐANG GHI → "${terminal.name}" · ${model.ten} · nói ngay · ${PHIM} để dừng và gửi`;
    this.thanh.show();
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Đang ghi âm cho terminal "${terminal.name}" (${model.ten}) — nói ngay; xong bấm ${PHIM} hoặc Cancel để gửi đi, chữ về sẽ được đưa vào terminal, bạn tự Enter`,
        cancellable: true,
      },
      (_t, token) =>
        new Promise<void>((resolve) => {
          this.dongThongBao = resolve;
          token.onCancellationRequested(() => void this.dungCloud());
        }),
    );
  }

  private async dungCloud(): Promise<void> {
    const p = this.phienCloud;
    if (p === null || this.dangDung) return;
    this.dangDung = true;
    this.phienCloud = null;
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, false);
    this.dongThongBao?.();
    this.dongThongBao = null;
    try {
      this.thanh.text = `$(sync~spin) Đang chuyển âm bằng ${p.model.ten}…`;
      const ghi = await p.may.dung();
      this.ghi(`cloud: đã ghi ${ghi.giay.toFixed(1)} s, ${ghi.wav.length} byte, peak ${ghi.peak}`);
      if (ghi.giay < 0.4) {
        void vscode.window.showWarningMessage('Đoạn ghi quá ngắn, chưa gửi.');
        return;
      }
      if (ghi.peak < 200) {
        void vscode.window.showWarningMessage(
          `Micro gần như câm (đỉnh ${ghi.peak}/32767) — kiểm tra micro mặc định của Windows (Settings → Sound → Input). Chưa gửi.`,
        );
        return;
      }
      const chu = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Đang chuyển âm bằng ${p.model.ten} (${ghi.giay.toFixed(0)} s âm thanh)…` },
        () => this.goiCloud(p.model, ghi.wav),
      );
      if (!chu.ok) {
        this.ghi(`cloud lỗi: ${chu.loi}`);
        if (p.model.nha === 'quan') {
          void vscode.window.showWarningMessage(chu.loi);
        } else {
          void vscode.window.showWarningMessage(chu.loi, 'Nhập lại API key').then((t) => {
            if (t === 'Nhập lại API key') void this.nhapKey(p.model.nha as NhaCloud);
          });
        }
        return;
      }
      const motDong = gopVeMotDong(chu.text);
      if (motDong === '') {
        void vscode.window.showWarningMessage('Dịch vụ không nghe ra chữ nào.');
        return;
      }
      p.terminal.show(false);
      p.terminal.sendText(motDong, false);
      this.ghi(`cloud: đã đưa ${motDong.length} ký tự vào "${p.terminal.name}"`);
      const rutGon = motDong.length > 80 ? `${motDong.slice(0, 80)}…` : motDong;
      vscode.window.setStatusBarMessage(`$(mic) Đã đưa vào "${p.terminal.name}": ${rutGon} — Enter để gửi`, 8_000);
    } catch (e) {
      this.ghi(`cloud lỗi: ${e instanceof Error ? e.message : String(e)}`);
      void vscode.window.showWarningMessage(`Ghi âm / chuyển âm thất bại: ${lamSachLoi(e instanceof Error ? e.message : String(e))}`);
    } finally {
      this.thanh.hide();
      this.dangDung = false;
    }
  }

  /**
   * Bảo đảm tiến trình QUAN đã nạp xong model. Hiện tiến độ vì lần đầu mất hàng chục giây (và
   * lần đầu tiên trên máy còn phải tải trọng số về).
   */
  private async chuanBiQuan(): Promise<boolean> {
    const python = this.cauHinh.get<string>(KHOA_CAI_DAT_PYTHON, 'python');
    this.mayQuan ??= new MayQuan(python, path.join(this.duongDanExtension, 'media', 'quan-server.py'), (d) => this.ghi(d));
    if (this.mayQuan.daSanSang) return true;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Đang nạp model QUAN-Transcribe (lần đầu mỗi cửa sổ; lần đầu tiên trên máy còn phải tải trọng số)…',
        },
        () => (this.mayQuan as MayQuan).nap(),
      );
      return true;
    } catch (e) {
      const loi = e instanceof Error ? e.message : String(e);
      this.ghi(`QUAN không nạp được: ${loi}`);
      this.mayQuan = null;
      // Thiếu gói thì thông điệp CHÍNH LÀ hướng dẫn cài (lớp MayQuan đã đổi), nên hiện nguyên văn
      // trong hộp thoại có thể copy được, kèm nút mở trang model.
      const laHuongDan = loi.startsWith('Chưa cài QUAN-Transcribe');
      const tra = await vscode.window.showWarningMessage(
        laHuongDan ? 'Chưa cài QUAN-Transcribe' : 'Không nạp được model QUAN',
        { modal: true, detail: laHuongDan ? loi : `${loi}

${huongDanCaiQuan(python)}` },
        'Mở trang model',
      );
      if (tra === 'Mở trang model') {
        void vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/${MODEL_QUAN === 'quan' ? 'qnguyen3/QUAN-Transcribe-1.0' : ''}`));
      }
      return false;
    }
  }

  private async goiCloud(model: ModelSTT, wav: Uint8Array): Promise<{ ok: true; text: string } | { ok: false; loi: string }> {
    if (model.nha === 'quan') return this.goiQuan(wav);
    const nha = model.nha as NhaCloud;
    const key = await this.layKey(nha);
    if (key === null) return { ok: false, loi: `Chưa có API key ${nha}.` };
    const ngonNgu = this.cauHinh.get<string>(KHOA_CAI_DAT_NGON_NGU, 'vi');
    const yc = nha === 'openai' ? dungYeuCauOpenAI(model, wav, ngonNgu, key) : dungYeuCauGemini(model, wav, ngonNgu, key);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(yc.url, { method: 'POST', headers: yc.headers, body: yc.body, signal: AbortSignal.timeout(HAN_GOI_API_MS) });
    } catch (e) {
      return { ok: false, loi: `Không gọi được ${nha}: ${lamSachLoi(e instanceof Error ? e.message : String(e))}` };
    }
    const raw = await res.text();
    this.ghi(`cloud ${model.tenApi}: HTTP ${res.status} sau ${Date.now() - t0} ms`);
    return nha === 'openai' ? docKetQuaOpenAI(res.status, raw) : docKetQuaGemini(res.status, raw);
  }

  /**
   * Chuyển âm bằng QUAN. Tiến trình Python nhận ĐƯỜNG DẪN file (không phải byte qua stdin) để
   * giao thức giữa hai bên chỉ là chữ — đỡ hẳn một lớp đóng gói nhị phân dễ sai.
   */
  private async goiQuan(wav: Uint8Array): Promise<{ ok: true; text: string } | { ok: false; loi: string }> {
    const may = this.mayQuan;
    if (may === null) return { ok: false, loi: 'Tiến trình QUAN chưa sẵn sàng.' };
    const f = path.join(os.tmpdir(), `ai-workspace-quan-${Date.now()}.wav`);
    try {
      await fs.writeFile(f, wav);
      const kq = await may.chuyenAm(f);
      this.ghi(`QUAN: ${kq.text.length} ký tự sau ${kq.ms} ms`);
      return { ok: true, text: kq.text };
    } catch (e) {
      return { ok: false, loi: `QUAN: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      void fs.unlink(f).catch(() => undefined);
    }
  }

  /** Mở tab nháp và bật dictation của VS Code vào đó. `null` nếu VS Code từ chối. */
  private async batDictation(tenDich: string): Promise<vscode.TextDocument | null> {
    // Tài liệu nháp untitled: dictation của VS Code cần một editor đang hoạt động để gõ vào.
    // Đóng không lưu ở bước dừng, không để lại file nào.
    const nhap = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '' });
    await vscode.window.showTextDocument(nhap, { preview: true, preserveFocus: false });
    await this.batWordWrap(nhap);
    this.ghi(`bật: đích "${tenDich}", tab nháp ${nhap.uri.toString()}, editor đang hoạt động = ${vscode.window.activeTextEditor?.document.uri.toString() ?? 'không có'}`);
    try {
      await vscode.commands.executeCommand(LENH_BAT);
      this.ghi('đã gọi editorDictation.start');
      return nhap;
    } catch (e) {
      this.ghi(`editorDictation.start ném lỗi: ${e instanceof Error ? e.message : String(e)}`);
      await this.dongNhap(nhap);
      void vscode.window.showWarningMessage(
        `Không bật được nghe giọng nói: ${e instanceof Error ? e.message : String(e)}. Cần VS Code ≥ 1.131 với dictation.enabled đang bật; lần đầu VS Code sẽ tải model về.`,
      );
      return null;
    }
  }

  /**
   * Cho tab nháp xuống dòng tự động để đọc lại được cả đoạn mà không phải cuộn ngang.
   *
   * Dùng lệnh toggle của VS Code vì API không có đường đặt `wordWrap` theo từng editor; lệnh đó
   * đặt một thuộc tính tạm chỉ sống trong model đang mở, nên KHÔNG đụng settings của người dùng
   * và mất theo tab khi ta đóng nó. Chỉ gọi khi đang thật sự tắt wrap — toggle là hai chiều.
   */
  private async batWordWrap(nhap: vscode.TextDocument): Promise<void> {
    const hienTai = vscode.workspace.getConfiguration('editor', nhap.uri).get<string>('wordWrap');
    if (!canBatWordWrap(hienTai)) {
      this.ghi(`wordWrap đang là "${hienTai}" — để nguyên`);
      return;
    }
    try {
      await vscode.commands.executeCommand('editor.action.toggleWordWrap');
      this.ghi('đã bật xuống dòng tự động cho tab nháp (chỉ tab này)');
    } catch (e) {
      // Không wrap thì vẫn đọc được bằng cách cuộn — không đáng làm hỏng cả phiên nghe.
      this.ghi(`không bật được wordWrap (bỏ qua): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private hienDangNghe(terminal: vscode.Terminal): void {
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, true);
    // Model chưa nóng thì nói thật: lời nói trong lúc nạp bị VS Code bỏ, dặn chờ là dặn thật.
    const nhac = this.modelNong ? 'nói được ngay' : 'ĐANG NẠP MODEL ~30 giây, chờ tab nháp hết báo "đang chuẩn bị" rồi mới nói';
    this.thanh.text = `$(mic-filled) ĐANG NGHE → "${terminal.name}" · ${nhac} · ${PHIM} để dừng`;
    this.thanh.show();
    // Thông báo tiến trình là "màn hình đang nghe" duy nhất VS Code cho phép mà không cướp focus
    // khỏi editor nháp (dictation gõ vào chỗ đang focus).
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Đang nghe cho terminal "${terminal.name}" — ${nhac}; nói xong bấm ${PHIM} hoặc Cancel: chữ sẽ được đưa vào terminal, bạn tự Enter`,
        cancellable: true,
      },
      (_tienTrinh, token) =>
        new Promise<void>((resolve) => {
          this.dongThongBao = resolve;
          token.onCancellationRequested(() => void this.dung());
        }),
    );
  }

  /**
   * Làm nóng model lúc cửa sổ mở: bật một phiên dictation vào tab nháp trong LAM_NONG_MS rồi
   * dừng. Không có cách nào khác — VS Code không cấp API nạp model mà không mở micro (lệnh cài
   * model chỉ tải file). Vì micro sẽ sáng vài chục giây ngay sau khi mở cửa sổ, việc này có
   * setting để tắt, và thanh trạng thái nói rõ đang làm gì.
   */
  async lamNong(): Promise<void> {
    if (vscode.workspace.getConfiguration().get<boolean>(KHOA_CAI_DAT_LAM_NONG, true) !== true) return;
    if (this.phien !== null || this.modelNong) return;
    this.thanh.backgroundColor = undefined;
    this.thanh.text = `$(sync~spin) Đang nạp model giọng nói (~${LAM_NONG_MS / 1000} s, một lần mỗi cửa sổ) — bấm ${PHIM} để nghe luôn`;
    this.thanh.show();
    const nhap = await this.batDictation('(làm nóng)');
    if (nhap === null) {
      this.thanh.hide();
      this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }
    this.phien = { terminal: undefined as unknown as vscode.Terminal, nhap, lamNong: true };
    const han = Date.now() + LAM_NONG_MS;
    while (Date.now() < han) {
      await new Promise((r) => setTimeout(r, 500));
      // Người dùng đã bấm: phiên này thành phiên thật, không phải việc của ta nữa.
      if (this.phien === null || !this.phien.lamNong) {
        this.modelNong = true;
        this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
      }
    }
    const p = this.phien;
    this.phien = null;
    this.modelNong = true;
    try {
      await vscode.commands.executeCommand(LENH_DUNG);
    } catch {
      /* đã bị dừng từ nút mic — không sao */
    }
    await this.dongNhap(p.nhap);
    this.thanh.hide();
    this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.ghi(`làm nóng xong sau ${LAM_NONG_MS / 1000} s — các lần nghe sau nói được ngay`);
    vscode.window.setStatusBarMessage(`$(mic) Giọng nói sẵn sàng — ${PHIM} để nói vào terminal`, 6_000);
  }

  private async xoaNoiDung(nhap: vscode.TextDocument): Promise<void> {
    try {
      const editor = await vscode.window.showTextDocument(nhap, { preview: true, preserveFocus: false });
      const toanBo = new vscode.Range(nhap.positionAt(0), nhap.positionAt(nhap.getText().length));
      await editor.edit((b) => b.delete(toanBo));
    } catch {
      /* tài liệu đã đóng — phiên sẽ tự thất bại ở bước dừng với thông báo rõ */
    }
  }

  private async dung(): Promise<void> {
    const phien = this.phien;
    if (phien === null || phien.lamNong || this.dangDung) return;
    this.dangDung = true;
    // Một phiên thật đã chạy trọn thì model chắc chắn đã trong RAM.
    this.modelNong = true;
    try {
      void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, false);
      this.thanh.hide();
      this.dongThongBao?.();
      this.dongThongBao = null;
      this.ghi(`dừng: tab nháp đang có ${phien.nhap.getText().length} ký tự trước khi gọi stop`);
      try {
        await vscode.commands.executeCommand(LENH_DUNG);
      } catch (e) {
        this.ghi(`editorDictation.stop ném lỗi (bỏ qua): ${e instanceof Error ? e.message : String(e)}`);
      }
      const chu = await this.choChuOnDinh(phien.nhap);
      this.ghi(`sau khi chữ ổn định: ${chu.length} ký tự`);
      await this.dongNhap(phien.nhap);
      phien.terminal.show(false);
      // GỘP VỀ MỘT DÒNG: trong TUI của agent mỗi xuống dòng là một lần Enter, mà Enter là của
      // người dùng. Dấu câu thì giữ — đây là prompt cho agent, không phải dòng lệnh shell.
      const motDong = gopVeMotDong(chu);
      if (motDong === '') {
        void vscode.window.showWarningMessage(
          'Không nghe được chữ nào. Nói lại sau khi thấy tiếng báo; vẫn không ra thì chạy "AI Workspace: Chọn micro nghe giọng nói".',
        );
        return;
      }
      phien.terminal.sendText(motDong, false);
      this.ghi(`đã đưa ${motDong.length} ký tự vào "${phien.terminal.name}"`);
      const rutGon = motDong.length > 80 ? `${motDong.slice(0, 80)}…` : motDong;
      vscode.window.setStatusBarMessage(`$(mic) Đã đưa vào "${phien.terminal.name}": ${rutGon} — Enter để gửi`, 8_000);
    } finally {
      this.phien = null;
      this.dangDung = false;
    }
  }

  /** Chữ trong tài liệu nháp sau khi dừng — chờ tới khi nó không đổi nữa (VS Code chuyển âm nốt đoạn cuối). */
  private async choChuOnDinh(nhap: vscode.TextDocument): Promise<string> {
    const han = Date.now() + CHO_TOI_DA_MS;
    let truoc = nhap.getText();
    let onDinhTu = Date.now();
    while (Date.now() < han) {
      await new Promise((r) => setTimeout(r, 200));
      const nay = nhap.getText();
      if (nay !== truoc) {
        truoc = nay;
        onDinhTu = Date.now();
      } else if (Date.now() - onDinhTu >= CHO_ON_DINH_MS) {
        break;
      }
    }
    return truoc;
  }

  /** Đóng tài liệu nháp KHÔNG lưu, không hỏi. */
  private async dongNhap(nhap: vscode.TextDocument): Promise<void> {
    try {
      await vscode.window.showTextDocument(nhap, { preview: true, preserveFocus: false });
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } catch {
      /* tài liệu đã bị người dùng đóng — không sao */
    }
  }

  dispose(): void {
    if (this.phien !== null) void this.dung();
    this.phienCloud?.may.huy();
    this.phienCloud = null;
    this.mayQuan?.dung();
    this.mayQuan = null;
    this.thanh.dispose();
    this.kenh.dispose();
  }

  /**
   * Mở bảng chọn micro của VS Code. Dictation lấy micro "mặc định" theo Chromium; trên máy có
   * micro ảo (app chia sẻ màn hình…) cái đó có thể là một thiết bị câm — model nghe toàn im lặng,
   * kết thúc với transcript rỗng mà không báo lỗi. Chọn tay đúng micro thật là cách gỡ; VS Code
   * nhớ lựa chọn này.
   */
  async chonMic(): Promise<void> {
    try {
      await vscode.commands.executeCommand(LENH_CHON_MIC_VSCODE);
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Không mở được bảng chọn micro của VS Code: ${e instanceof Error ? e.message : String(e)}. Thử Command Palette → "Voice: Select Microphone".`,
      );
    }
  }
}

/**
 * Bảo đảm phím tắt tới được extension khi terminal đang focus.
 *
 * VS Code mặc định chuyển hầu hết phím vào shell khi terminal focus; chỉ lệnh nằm trong
 * `terminal.integrated.commandsToSkipShell` mới được giữ lại. Extension KHÔNG khai được vào
 * danh sách đó bằng `contributes`, nên phải ghi vào cài đặt người dùng — một lần, có báo.
 * Không làm thế thì phím trong terminal bị đẩy xuống shell và không bao giờ tới được ta.
 *
 * Nhận cả danh sách vì nay có nhiều phím cần đi qua shell (nghe giọng nói, nhảy terminal);
 * ghi một lần cho tất cả thay vì bắn nhiều thông báo liên tiếp vào mặt người dùng.
 */
export async function damBaoPhimQuaShell(
  canThem: readonly { id: string; phim: string; viec: string }[] = [
    { id: LENH_TOGGLE, phim: PHIM, viec: 'bật nghe giọng nói' },
  ],
): Promise<void> {
  const KHOA = 'terminal.integrated.commandsToSkipShell';
  const cauHinh = vscode.workspace.getConfiguration();
  const hienCo = cauHinh.get<string[]>(KHOA, []);
  const thieu = canThem.filter((x) => !hienCo.includes(x.id));
  if (thieu.length === 0) return;
  const moTa = thieu.map((x) => `${x.phim} → ${x.viec}`).join(', ');
  try {
    await cauHinh.update(KHOA, [...hienCo, ...thieu.map((x) => x.id)], vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      `Đã thêm ${thieu.length} lệnh vào ${KHOA} để trong terminal các phím này tới được extension thay vì bị shell nuốt: ${moTa}.`,
    );
  } catch {
    void vscode.window.showWarningMessage(
      `Không ghi được ${KHOA}. Thêm tay ${thieu.map((x) => `"${x.id}"`).join(', ')} vào cài đặt đó, không thì các phím ${moTa} trong terminal sẽ bị shell nuốt.`,
    );
  }
}
