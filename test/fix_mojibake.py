"""Undo UTF-8 text that was read as Windows-1252 and re-saved as UTF-8 (e.g. "â€“" -> "–")."""
import sys
from pathlib import Path


def to_bytes(ch):
    try:
        return ch.encode("cp1252")
    except UnicodeEncodeError:
        if ord(ch) < 256:  # bytes cp1252 leaves undefined (0x81, 0x8d, ...) came through as U+0081 etc.
            return bytes([ord(ch)])
        raise


for name in sys.argv[1:]:
    p = Path(name)
    text = p.read_text(encoding="utf-8-sig")
    # Line by line: lines written after the damage are already correct and won't round-trip.
    out = []
    for line in text.split("\n"):
        try:
            out.append(b"".join(to_bytes(ch) for ch in line).decode("utf-8"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            out.append(line)
    fixed = "\n".join(out)
    p.write_text(fixed, encoding="utf-8", newline="\n")
    print(name, "fixed" if fixed != text else "unchanged")
