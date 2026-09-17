# Ghi âm micro mặc định ra WAV 16 kHz mono 16-bit bằng WinMM (waveIn), không cần cài gì thêm.
#
# Vì sao là PowerShell + WinMM: extension host không mở được micro (webview bị chặn bởi
# Permissions-Policy, module native thì phải build theo từng Electron), còn PowerShell + winmm.dll
# có sẵn trên mọi Windows. Giao thức với tiến trình cha rất mỏng để không có gì mà lệch:
#   stdout "READY"            ← đã bắt đầu ghi
#   stdin  một dòng bất kỳ    → dừng ghi
#   stdout "DONE <bytes> <peak>" ← đã ghi file; peak 0..32767 để bên gọi phát hiện micro câm
param([Parameter(Mandatory = $true)][string]$OutPath)

$src = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public static class GhiAm {
  [StructLayout(LayoutKind.Sequential)]
  public struct WAVEFORMATEX { public short wFormatTag; public short nChannels; public int nSamplesPerSec; public int nAvgBytesPerSec; public short nBlockAlign; public short wBitsPerSample; public short cbSize; }
  [StructLayout(LayoutKind.Sequential)]
  public struct WAVEHDR { public IntPtr lpData; public int dwBufferLength; public int dwBytesRecorded; public IntPtr dwUser; public int dwFlags; public int dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint dev, ref WAVEFORMATEX f, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);
  const int WHDR_DONE = 1;
  static volatile bool dung = false;
  public static void Chay(string outPath) {
    var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = 16000, wBitsPerSample = 16, nBlockAlign = 2, nAvgBytesPerSec = 32000, cbSize = 0 };
    IntPtr h;
    int r = waveInOpen(out h, 0xFFFFFFFF, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) throw new Exception("waveInOpen that bai, ma " + r);
    int n = 6, kich = 8000; // 6 đệm × 0,25 s
    int hdrSize = Marshal.SizeOf(typeof(WAVEHDR));
    var hdrs = new IntPtr[n]; var bufs = new IntPtr[n];
    for (int i = 0; i < n; i++) {
      bufs[i] = Marshal.AllocHGlobal(kich);
      hdrs[i] = Marshal.AllocHGlobal(hdrSize);
      var hd = new WAVEHDR { lpData = bufs[i], dwBufferLength = kich };
      Marshal.StructureToPtr(hd, hdrs[i], false);
      waveInPrepareHeader(h, hdrs[i], hdrSize);
      waveInAddBuffer(h, hdrs[i], hdrSize);
    }
    r = waveInStart(h);
    if (r != 0) throw new Exception("waveInStart that bai, ma " + r);
    var t = new Thread(() => { try { Console.In.ReadLine(); } catch { } dung = true; });
    t.IsBackground = true; t.Start();
    Console.Out.WriteLine("READY"); Console.Out.Flush();
    var pcm = new MemoryStream();
    int offFlags = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwFlags");
    int offRec = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwBytesRecorded");
    var tmp = new byte[kich];
    int peak = 0;
    while (true) {
      bool coViec = false;
      for (int i = 0; i < n; i++) {
        int flags = Marshal.ReadInt32(hdrs[i], offFlags);
        if ((flags & WHDR_DONE) == 0) continue;
        int len = Marshal.ReadInt32(hdrs[i], offRec);
        Marshal.Copy(bufs[i], tmp, 0, len);
        for (int k = 0; k + 1 < len; k += 2) { int v = (short)(tmp[k] | (tmp[k + 1] << 8)); if (v < 0) v = -v; if (v > peak) peak = v; }
        pcm.Write(tmp, 0, len);
        coViec = true;
        if (dung) continue;
        waveInUnprepareHeader(h, hdrs[i], hdrSize);
        var hd = new WAVEHDR { lpData = bufs[i], dwBufferLength = kich };
        Marshal.StructureToPtr(hd, hdrs[i], false);
        waveInPrepareHeader(h, hdrs[i], hdrSize);
        waveInAddBuffer(h, hdrs[i], hdrSize);
      }
      if (dung) { waveInReset(h); break; }
      if (!coViec) Thread.Sleep(20);
    }
    // Vét nốt các đệm đã đầy sau reset.
    for (int i = 0; i < n; i++) {
      int flags = Marshal.ReadInt32(hdrs[i], offFlags);
      if ((flags & WHDR_DONE) != 0) { int len = Marshal.ReadInt32(hdrs[i], offRec); if (len > 0) { Marshal.Copy(bufs[i], tmp, 0, len); pcm.Write(tmp, 0, len); } }
      waveInUnprepareHeader(h, hdrs[i], hdrSize);
      Marshal.FreeHGlobal(hdrs[i]); Marshal.FreeHGlobal(bufs[i]);
    }
    waveInClose(h);
    var data = pcm.ToArray();
    using (var fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
    using (var w = new BinaryWriter(fs)) {
      w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + data.Length);
      w.Write(System.Text.Encoding.ASCII.GetBytes("WAVE")); w.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
      w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(16000); w.Write(32000); w.Write((short)2); w.Write((short)16);
      w.Write(System.Text.Encoding.ASCII.GetBytes("data")); w.Write(data.Length); w.Write(data);
    }
    Console.Out.WriteLine("DONE " + data.Length + " " + peak); Console.Out.Flush();
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp
[GhiAm]::Chay($OutPath)
