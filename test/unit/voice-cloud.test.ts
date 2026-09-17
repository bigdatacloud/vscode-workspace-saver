import { describe, expect, it } from 'vitest';
import {
  CAC_MODEL,
  docKetQuaGemini,
  docKetQuaOpenAI,
  dungYeuCauGemini,
  dungYeuCauOpenAI,
  gioiThieuModel,
  lamSachLoi,
  timModel,
  type ModelSTT,
} from '../../src/voice/cloud';

describe('danh sách model STT', () => {
  it('có đúng một model local và nó là mặc định', () => {
    const local = CAC_MODEL.filter((m) => m.nha === 'local');
    expect(local).toHaveLength(1);
    expect(local[0]?.id).toBe('local');
    expect(timModel(undefined)).toBe(local[0]);
  });

  it('id lạ hoặc rỗng rơi về local, không ném', () => {
    expect(timModel('khong-co').nha).toBe('local');
    expect(timModel('').nha).toBe('local');
  });

  it('mỗi model cloud nêu rõ nhà cung cấp và tên gọi API', () => {
    for (const m of CAC_MODEL.filter((x) => x.nha !== 'local')) {
      expect(m.tenApi).toBeTruthy();
      expect(['openai', 'gemini']).toContain(m.nha);
    }
  });

  it('gioiThieuModel: local nói offline, cloud nói cần key và gửi âm thanh đi', () => {
    expect(gioiThieuModel(timModel('local'))).toMatch(/offline/i);
    const gpt = CAC_MODEL.find((m) => m.nha === 'openai') as ModelSTT;
    expect(gioiThieuModel(gpt)).toMatch(/key/i);
  });
});

describe('OpenAI transcriptions', () => {
  const gpt = CAC_MODEL.find((m) => m.id === 'openai:gpt-4o-mini-transcribe') as ModelSTT;
  it('dựng request multipart đúng endpoint, đúng model, đúng ngôn ngữ, mang Bearer', () => {
    const yc = dungYeuCauOpenAI(gpt, new Uint8Array([1, 2, 3]), 'vi', 'sk-test');
    expect(yc.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(yc.headers.Authorization).toBe('Bearer sk-test');
    expect(yc.body).toBeInstanceOf(FormData);
    const f = yc.body as FormData;
    expect(f.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(f.get('language')).toBe('vi');
    expect(f.get('response_format')).toBe('json');
    expect((f.get('file') as Blob).type).toBe('audio/wav');
  });

  it('đọc text từ JSON; lỗi API thành thông điệp không lộ key', () => {
    expect(docKetQuaOpenAI(200, JSON.stringify({ text: ' xin chào ' }))).toEqual({ ok: true, text: 'xin chào' });
    const loi = docKetQuaOpenAI(401, JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abc123' } }));
    expect(loi.ok).toBe(false);
    if (!loi.ok) expect(loi.loi).not.toContain('sk-abc123');
  });

  it('JSON hỏng hoặc thiếu text → lỗi có kiểu, không ném', () => {
    expect(docKetQuaOpenAI(200, '{').ok).toBe(false);
    expect(docKetQuaOpenAI(200, JSON.stringify({ x: 1 })).ok).toBe(false);
  });
});

describe('Gemini generateContent', () => {
  const gem = CAC_MODEL.find((m) => m.nha === 'gemini') as ModelSTT;
  it('dựng request JSON với âm thanh inline base64 và chỉ dẫn chỉ trả transcript', () => {
    const yc = dungYeuCauGemini(gem, new Uint8Array([0, 255]), 'vi', 'AIza-test');
    expect(yc.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${gem.tenApi}:generateContent`);
    expect(yc.headers['x-goog-api-key']).toBe('AIza-test');
    expect(yc.url).not.toContain('AIza-test');
    const than = JSON.parse(yc.body as string);
    const parts = than.contents[0].parts;
    expect(parts[1].inline_data.mime_type).toBe('audio/wav');
    expect(parts[1].inline_data.data).toBe(Buffer.from([0, 255]).toString('base64'));
    expect(parts[0].text).toMatch(/tiếng Việt|Vietnamese/);
  });

  it('đọc text từ candidates; chặn thẳng khi bị safety từ chối', () => {
    const ok = docKetQuaGemini(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'một hai ba\n' }] } }] }));
    expect(ok).toEqual({ ok: true, text: 'một hai ba' });
    const tu = docKetQuaGemini(200, JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }));
    expect(tu.ok).toBe(false);
    const loi = docKetQuaGemini(400, JSON.stringify({ error: { message: 'API key not valid. key=AIzaXYZ' } }));
    expect(loi.ok).toBe(false);
    if (!loi.ok) expect(loi.loi).not.toContain('AIzaXYZ');
  });
});

describe('lamSachLoi', () => {
  it('che khoá sk-… và AIza… trong mọi thông điệp', () => {
    expect(lamSachLoi('bad sk-abcDEF123 and AIzaSyXYZ_9')).not.toMatch(/sk-abcDEF123|AIzaSyXYZ_9/);
  });
});
