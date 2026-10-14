"""Tiến trình nhận dạng QUAN-Transcribe thường trú cho extension AI Workspace.

Giao thức cố ý mỏng, mỗi dòng một thông điệp JSON trên stdout:
  {"ready": true}          <- model đã nạp xong, bắt đầu nhận việc
  {"text": "..."}          <- kết quả của một file
  {"error": "..."}         <- file đó hỏng, tiến trình vẫn sống

stdin: mỗi dòng là một đường dẫn file WAV. Dòng rỗng bỏ qua, EOF thì thoát.

Vì sao thường trú: `from_pretrained` nạp vài trăm MB mỗi lần khởi động. Gọi một tiến trình mới
cho mỗi câu nói nghĩa là chờ nạp model mỗi lần.
"""

import json
import sys


def ghi(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    repo = sys.argv[1] if len(sys.argv) > 1 else "qnguyen3/QUAN-Transcribe-1.0"
    # Import ở trong hàm để ModuleNotFoundError đi ra stderr đúng lúc extension đang chờ "ready";
    # extension nhận ra lỗi đó và hiện hướng dẫn cài thay vì vết lỗi Python.
    from quan_transcribe import QuanTranscribe  # noqa: PLC0415

    asr = QuanTranscribe.from_pretrained(repo)
    ghi({"ready": True})

    for dong in sys.stdin:
        duong_dan = dong.strip().strip('"')
        if not duong_dan:
            continue
        try:
            text = asr.transcribe(duong_dan)
            ghi({"text": text if isinstance(text, str) else str(text)})
        except Exception as e:  # noqa: BLE001 — một file hỏng không được giết cả tiến trình
            ghi({"error": f"{type(e).__name__}: {e}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
