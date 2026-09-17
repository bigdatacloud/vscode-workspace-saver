/**
 * Chuyển giọng nói thành chữ qua dịch vụ cloud — phần THUẦN: danh sách model, dựng request, đọc
 * kết quả. Không import vscode, không gọi mạng: lớp gọi mạng nằm ở `giongnoi.ts`, còn đây là chỗ
 * test được từng byte.
 *
 * Vì sao có cloud khi model cục bộ đã nói được ngay sau khi làm nóng: cloud không cần nạp gì (bấm
 * là ghi, dừng là gửi), đổi lại mất 1–3 giây sau khi dừng, cần API key, và âm thanh rời máy.
 * Người dùng chọn, extension không chọn hộ.
 */

export type NhaCungCap = 'local' | 'openai' | 'gemini';

export interface ModelSTT {
  /** Id lưu trong setting `aiWorkspace.voice.model`. */
  id: string;
  nha: NhaCungCap;
  /** Tên hiển thị trong bảng chọn. */
  ten: string;
  /** Tên gửi lên API; rỗng với local. */
  tenApi: string;
  moTa: string;
}

/**
 * Model Gemini lấy theo bảng đã kiểm 2026-08-17 (xem CLAUDE.md toàn cục): chỉ dùng id còn sống,
 * ưu tiên bản stable. Model OpenAI theo endpoint /v1/audio/transcriptions.
 */
export const CAC_MODEL: readonly ModelSTT[] = [
  { id: 'local', nha: 'local', ten: 'Local — Nemotron 3.5 (VS Code)', tenApi: '', moTa: 'offline, không cần key; nạp model ~40 s một lần mỗi cửa sổ (extension tự làm nóng lúc mở)' },
  { id: 'openai:gpt-4o-mini-transcribe', nha: 'openai', ten: 'OpenAI — gpt-4o-mini-transcribe', tenApi: 'gpt-4o-mini-transcribe', moTa: 'nhanh, rẻ; cần OpenAI API key; âm thanh gửi lên OpenAI' },
  { id: 'openai:gpt-4o-transcribe', nha: 'openai', ten: 'OpenAI — gpt-4o-transcribe', tenApi: 'gpt-4o-transcribe', moTa: 'chính xác hơn mini; cần OpenAI API key; âm thanh gửi lên OpenAI' },
  { id: 'openai:whisper-1', nha: 'openai', ten: 'OpenAI — whisper-1', tenApi: 'whisper-1', moTa: 'đời cũ, ổn định; cần OpenAI API key' },
  // Thứ tự Gemini theo độ trễ đo 2026-09-17 với 6 s âm thanh tiếng Việt: flash-lite ~1,6–5 s;
  // 3.5-flash ~7 s khi tắt suy nghĩ (30 s nếu không tắt); 3.7-flash hay trả 503 quá tải.
  { id: 'gemini:gemini-3.1-flash-lite', nha: 'gemini', ten: 'Gemini — gemini-3.1-flash-lite', tenApi: 'gemini-3.1-flash-lite', moTa: 'nhanh nhất (~2 s), rẻ nhất; cần Gemini API key; âm thanh gửi lên Google' },
  { id: 'gemini:gemini-3.5-flash', nha: 'gemini', ten: 'Gemini — gemini-3.5-flash', tenApi: 'gemini-3.5-flash', moTa: 'stable, ~7 s; cần Gemini API key' },
  { id: 'gemini:gemini-3.7-flash', nha: 'gemini', ten: 'Gemini — gemini-3.7-flash', tenApi: 'gemini-3.7-flash', moTa: 'Flash đời mới nhất, hay quá tải (503); cần Gemini API key' },
];

const MAC_DINH = CAC_MODEL[0] as ModelSTT;

/** Id không có trong danh sách (setting gõ tay, model đã khai tử) rơi về local — không bao giờ ném. */
export function timModel(id: string | undefined): ModelSTT {
  return CAC_MODEL.find((m) => m.id === id) ?? MAC_DINH;
}

export function gioiThieuModel(m: ModelSTT): string {
  return m.moTa;
}

export interface YeuCauHttp {
  url: string;
  headers: Record<string, string>;
  body: FormData | string;
}

export type KetQuaSTT = { ok: true; text: string } | { ok: false; loi: string };

/** Che khoá trong thông điệp lỗi: lỗi hiện lên thông báo và vào kênh log, không được mang khoá theo. */
export function lamSachLoi(msg: string): string {
  return msg.replace(/\bsk-[A-Za-z0-9_-]+/g, '[khoá đã che]').replace(/\bAIza[A-Za-z0-9_-]+/g, '[khoá đã che]');
}

export function dungYeuCauOpenAI(m: ModelSTT, wav: Uint8Array, ngonNgu: string, key: string): YeuCauHttp {
  const form = new FormData();
  form.append('model', m.tenApi);
  form.append('language', ngonNgu);
  form.append('response_format', 'json');
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'giong-noi.wav');
  return { url: 'https://api.openai.com/v1/audio/transcriptions', headers: { Authorization: `Bearer ${key}` }, body: form };
}

export function docKetQuaOpenAI(status: number, raw: string): KetQuaSTT {
  let o: Record<string, unknown>;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return { ok: false, loi: 'OpenAI trả về không phải JSON.' };
    o = p as Record<string, unknown>;
  } catch {
    return { ok: false, loi: `OpenAI trả về không đọc được (HTTP ${status}).` };
  }
  const err = o.error as { message?: unknown } | undefined;
  if (status >= 400 || err !== undefined) {
    const msg = typeof err?.message === 'string' ? err.message : `HTTP ${status}`;
    return { ok: false, loi: `OpenAI: ${lamSachLoi(msg)}` };
  }
  if (typeof o.text !== 'string') return { ok: false, loi: 'OpenAI không trả về text.' };
  return { ok: true, text: o.text.trim() };
}

export function dungYeuCauGemini(m: ModelSTT, wav: Uint8Array, ngonNgu: string, key: string): YeuCauHttp {
  const tenNgonNgu = ngonNgu === 'vi' ? 'tiếng Việt' : ngonNgu;
  const than = {
    contents: [
      {
        parts: [
          {
            text: `Chép lại NGUYÊN VĂN lời nói trong đoạn âm thanh (${tenNgonNgu}), có dấu câu. Chỉ trả về bản chép lời, không giải thích, không thêm gì. Nếu không nghe thấy lời nói thì trả về chuỗi rỗng.`,
          },
          { inline_data: { mime_type: 'audio/wav', data: Buffer.from(wav).toString('base64') } },
        ],
      },
    ],
    // Tắt "suy nghĩ": với chép lời thì suy nghĩ chỉ tốn thời gian — đo được 3.5-flash từ 30 s
    // xuống 7 s. Model không có thinking vẫn nhận trường này bình thường (đã thử flash-lite).
    generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  };
  // Khoá đi trong header, không đi trong URL: URL hay bị ghi vào log và lịch sử proxy.
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${m.tenApi}:generateContent`,
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(than),
  };
}

export function docKetQuaGemini(status: number, raw: string): KetQuaSTT {
  let o: Record<string, unknown>;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return { ok: false, loi: 'Gemini trả về không phải JSON.' };
    o = p as Record<string, unknown>;
  } catch {
    return { ok: false, loi: `Gemini trả về không đọc được (HTTP ${status}).` };
  }
  const err = o.error as { message?: unknown } | undefined;
  if (status >= 400 || err !== undefined) {
    const msg = typeof err?.message === 'string' ? err.message : `HTTP ${status}`;
    return { ok: false, loi: `Gemini: ${lamSachLoi(msg)}` };
  }
  const cands = Array.isArray(o.candidates) ? (o.candidates as Record<string, unknown>[]) : [];
  const c0 = cands[0];
  if (c0 === undefined) return { ok: false, loi: 'Gemini không trả về ứng viên nào.' };
  const content = c0.content as { parts?: { text?: unknown }[] } | undefined;
  const text = content?.parts?.map((p) => (typeof p.text === 'string' ? p.text : '')).join('') ?? '';
  if (text.trim() === '') {
    const lyDo = typeof c0.finishReason === 'string' ? c0.finishReason : 'không rõ';
    return { ok: false, loi: `Gemini không trả về chữ (finishReason=${lyDo}).` };
  }
  return { ok: true, text: text.trim() };
}
