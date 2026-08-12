import { describe, expect, it } from 'vitest';
import { khiKetThucLenh, nenBatLenh } from '../../src/capture/rules';

describe('nenBatLenh', () => {
  it('chỉ bắt cho terminal plain, không bắt lệnh agent, không bắt lệnh rỗng', () => {
    expect(nenBatLenh('plain', false, 'npm run dev')).toBe(true);
    expect(nenBatLenh('claude', false, 'npm run dev')).toBe(false);
    expect(nenBatLenh('plain', true, 'claude --resume abc')).toBe(false);
    expect(nenBatLenh('plain', false, '   ')).toBe(false);
  });
});

describe('khiKetThucLenh', () => {
  const p = { lenh: 'npm run dev', luuTruoc: 'lệnh cũ', batDauLuc: 1000, token: {} };

  it('lệnh chạy đủ lâu → giữ lệnh đó làm startCommand', () => {
    expect(khiKetThucLenh(p, 1000 + 15_000)).toBe('npm run dev');
  });

  it('lệnh vặt (chạy ngắn) → trả lại giá trị trước', () => {
    expect(khiKetThucLenh(p, 1000 + 14_999)).toBe('lệnh cũ');
  });

  it('lệnh vặt mà trước đó chưa có gì → undefined (xóa)', () => {
    expect(khiKetThucLenh({ ...p, luuTruoc: undefined }, 1000 + 3_000)).toBeUndefined();
  });

  it('ngưỡng tùy biến được', () => {
    expect(khiKetThucLenh(p, 1000 + 500, 400)).toBe('npm run dev');
  });
});

describe('lệnh chứa bí mật', () => {
  // startCommand nằm plaintext trong workspaces.json VÀ được chạy lại ở lần khôi phục sau.
  it('không bắt lệnh có dấu hiệu token/mật khẩu', () => {
    const cac = [
      'mysql -pHunter2 -u root',
      'curl -H "Authorization: Bearer sk-abcdefghijklmnop" https://api.x',
      'git push https://user:pass@github.com/a/b.git',
      'export OPENAI_API_KEY=sk-abcdefghijklmnopqrst',
      'deploy --password=hunter2',
      'gh auth login --token ghp_abcdefghijklmnopqrstuvwxyz012345',
    ];
    for (const lenh of cac) expect(nenBatLenh('plain', false, lenh)).toBe(false);
  });

  it('vẫn bắt lệnh thường trông giống nhưng vô hại', () => {
    expect(nenBatLenh('plain', false, 'npm run dev')).toBe(true);
    expect(nenBatLenh('plain', false, 'docker compose up -p myproject')).toBe(true);
    expect(nenBatLenh('plain', false, 'ssh server')).toBe(true);
  });
});

describe('khiKetThucLenh với mã thoát', () => {
  const p = { lenh: 'npm run build', luuTruoc: 'npm run dev', batDauLuc: 0, token: {} };

  it('chạy lâu nhưng THOÁT LỖI → không nhớ, trả lại giá trị cũ', () => {
    expect(khiKetThucLenh(p, 60_000, undefined, 1)).toBe('npm run dev');
  });

  it('chạy lâu và thoát 0 → nhớ', () => {
    expect(khiKetThucLenh(p, 60_000, undefined, 0)).toBe('npm run build');
  });

  it('không biết mã thoát (shell integration không báo) → giữ nguyên luật thời gian', () => {
    expect(khiKetThucLenh(p, 60_000, undefined, undefined)).toBe('npm run build');
    expect(khiKetThucLenh(p, 1_000, undefined, undefined)).toBe('npm run dev');
  });
});
