import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface GoiPhanMem {
  contributes: {
    configuration: { properties: Record<string, { default?: unknown; description?: string }> };
  };
}

const goi = (): GoiPhanMem => JSON.parse(readFileSync('package.json', 'utf8')) as GoiPhanMem;

function quet(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const day = join(thuMuc, ten);
    if (statSync(day).isDirectory()) ra.push(...quet(day));
    else if (day.endsWith('.ts')) ra.push(day);
  }
  return ra;
}

/**
 * Mặc định của một setting là HÀNH VI người dùng gặp khi chưa ai đụng vào cấu hình. Nguồn sự
 * thật là `contributes.configuration` trong package.json: khi khoá có khai `default`, chính
 * nó là thứ `workspace.getConfiguration().get()` trả về, không phải tham số dự phòng trong mã.
 */
describe('mặc định của các setting', () => {
  it('làm nóng model giọng nói: TẮT — mở cửa sổ không được tự bật micro', () => {
    // Anh Ý cấm tự ý mở micro trên máy này (17/09/2026). Làm nóng bật dictation 40 giây ngay
    // sau khi cửa sổ mở, nên để nó mặc định BẬT là vi phạm điều đó với mọi người cài mới — và
    // nó còn ném một tab nháp vào nhóm editor đang active, đè lên ô của lưới xem song song
    // (lỗi người dùng báo 26/10/2026).
    const khoa = goi().contributes.configuration.properties['aiWorkspace.voice.warmUpOnStartup'];
    expect(khoa, 'setting aiWorkspace.voice.warmUpOnStartup phải còn tồn tại').toBeDefined();
    expect(khoa?.default).toBe(false);
  });

  it('thu panel sau khi xếp lưới: BẬT, nhưng tắt được', () => {
    const khoa =
      goi().contributes.configuration.properties['aiWorkspace.splitView.closePanelAfterLayout'];
    expect(khoa, 'phải có van thoát cho việc thu panel — nó không test tự động được').toBeDefined();
    expect(khoa?.default).toBe(true);
    expect(khoa?.description ?? '').not.toBe('');
  });
});

/**
 * Lệch một ký tự giữa tên khoá trong mã và tên khai trong package.json thì setting im lặng
 * mất tác dụng: `get()` trả về `undefined`, mã rơi vào nhánh dự phòng, không ai báo lỗi.
 * TypeScript không bắt được vì cả hai chỉ là chuỗi.
 */
describe('mọi khoá cấu hình dùng trong mã đều phải được khai báo', () => {
  it('không có khoá aiWorkspace.* nào chỉ tồn tại trong mã', () => {
    const khaiBao = new Set(Object.keys(goi().contributes.configuration.properties));
    /**
     * Khoá của SecretStorage, KHÔNG phải cấu hình: chúng cố tình không khai trong
     * package.json vì người dùng không được sửa chúng qua Settings (xem `TEN_SECRET` trong
     * `src/ui/giongnoi.ts`). Đổi tên hai khoá này là làm người dùng mất key đã lưu.
     */
    const laSecret = new Set([
      'aiWorkspace.voice.openaiApiKey',
      'aiWorkspace.voice.geminiApiKey',
    ]);
    const thieu: string[] = [];
    for (const tep of quet('src')) {
      const nguon = readFileSync(tep, 'utf8');
      // Chỉ bắt chuỗi nguyên vẹn trong nháy đơn/kép — đủ cho cách mã này đặt hằng tên khoá.
      for (const khop of nguon.matchAll(/['"](aiWorkspace\.[A-Za-z0-9_.]+)['"]/g)) {
        const khoa = khop[1];
        if (khoa === undefined) continue;
        // Lệnh và ngữ cảnh khai ở `contributes.commands` / `when`, không phải configuration.
        if (!khoa.includes('.') || khaiBao.has(khoa) || laSecret.has(khoa)) continue;
        thieu.push(`${tep}: ${khoa}`);
      }
    }
    // Lệnh (aiWorkspace.viewSplitOff…) cũng khớp mẫu trên, nên chỉ đòi những khoá nào trông
    // như setting: có ít nhất hai dấu chấm sau tiền tố, hoặc nằm trong danh sách đã biết.
    const chiSetting = thieu.filter((d) => (d.split(': ')[1]?.match(/\./g)?.length ?? 0) >= 2);
    expect(chiSetting, `khoá dùng trong mã nhưng không khai trong package.json`).toEqual([]);
  });
});
