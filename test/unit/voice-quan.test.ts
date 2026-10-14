import { describe, expect, it } from 'vitest';
import { CAC_MODEL, timModel } from '../../src/voice/cloud';
import { docDongQuan, huongDanCaiQuan, laThieuGoiQuan, MODEL_QUAN } from '../../src/voice/quan';

describe('QUAN trong danh sách model', () => {
  it('đứng ĐẦU danh sách — người dùng muốn thấy nó trước tiên', () => {
    expect(CAC_MODEL[0]?.id).toBe(MODEL_QUAN);
  });

  it('là model chạy trên máy, không phải cloud', () => {
    const m = timModel(MODEL_QUAN);
    expect(m.nha).toBe('quan');
    expect(m.tenApi).toBe('qnguyen3/QUAN-Transcribe-1.0');
  });

  it('mô tả nói thẳng hai điều người dùng phải biết trước khi chọn', () => {
    const moTa = timModel(MODEL_QUAN).moTa;
    // Chữ thường không dấu câu là hành vi của model, không phải lỗi cài đặt — nói trước để
    // người dùng khỏi tưởng hỏng.
    expect(moTa).toMatch(/không dấu câu|chữ thường/i);
    expect(moTa).toMatch(/Python/i);
  });

  it('mặc định VẪN là Nemotron: model chạy được ngay mới được làm mặc định', () => {
    // QUAN cần cài Python + torch + nhận điều khoản Gemma. Để nó làm mặc định nghĩa là ai mở
    // extension lần đầu cũng gặp lỗi.
    expect(timModel(undefined).id).toBe('local');
  });
});

describe('docDongQuan — đọc một dòng từ tiến trình nhận dạng', () => {
  it('dòng ready báo model đã nạp xong', () => {
    expect(docDongQuan('{"ready":true}')).toEqual({ loai: 'ready' });
  });

  it('dòng text trả chữ đã trim', () => {
    expect(docDongQuan('{"text":"  xin chao  "}')).toEqual({ loai: 'text', text: 'xin chao' });
  });

  it('dòng error trả lý do', () => {
    expect(docDongQuan('{"error":"file not found"}')).toEqual({ loai: 'loi', loi: 'file not found' });
  });

  it('dòng log thường của Python (không phải JSON) bị bỏ qua, KHÔNG làm chết vòng đọc', () => {
    expect(docDongQuan('Downloading model 10%')).toBeNull();
    expect(docDongQuan('')).toBeNull();
    expect(docDongQuan('{')).toBeNull();
  });

  it('JSON hợp lệ nhưng không phải ba dạng trên → null', () => {
    expect(docDongQuan('{"gi do":1}')).toBeNull();
  });
});

describe('laThieuGoiQuan', () => {
  it('nhận ra ModuleNotFoundError để hiện hướng dẫn cài thay vì lỗi thô', () => {
    expect(laThieuGoiQuan("ModuleNotFoundError: No module named 'quan_transcribe'")).toBe(true);
    expect(laThieuGoiQuan("ImportError: cannot import name 'QuanTranscribe'")).toBe(true);
  });

  it('lỗi khác không bị nhầm thành thiếu gói', () => {
    expect(laThieuGoiQuan('RuntimeError: CUDA out of memory')).toBe(false);
    expect(laThieuGoiQuan('')).toBe(false);
  });
});

describe('huongDanCaiQuan', () => {
  it('nêu đúng lệnh pip và các gói cần có', () => {
    const h = huongDanCaiQuan('python');
    expect(h).toContain('pip install');
    expect(h).toContain('github.com/qnguyen3/QUAN-Transcribe');
    expect(h).toMatch(/torch/i);
  });

  it('nói trước cỡ tải về — đây là thứ người dùng sẽ bất ngờ nhất', () => {
    // Đo 2026-10-14 qua HF API: encoder nền google/embeddinggemma-2 1,49 GB + trọng số QUAN
    // 407 MB + LM 4-gram 91 MB. Không nói trước thì người dùng bấm xong ngồi chờ tải 2 GB.
    const h = huongDanCaiQuan('python');
    expect(h).toMatch(/embeddinggemma-2/);
    expect(h).toMatch(/GB/);
  });

  it('KHÔNG bắt đăng nhập Hugging Face: encoder nền đã mở (kiểm 2026-10-14, gated=false)', () => {
    // Bắt người ta nhận điều khoản + login cho một repo đang mở là thêm việc vô ích và làm họ
    // tưởng chưa login thì không chạy được.
    expect(huongDanCaiQuan('python')).not.toMatch(/login/i);
  });

  it('dùng đúng đường dẫn python người dùng đã cấu hình', () => {
    expect(huongDanCaiQuan('C:/Py310/python.exe')).toContain('C:/Py310/python.exe');
  });
});
