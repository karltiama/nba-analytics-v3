from pathlib import Path

from pypdf import PdfReader


def dump(path: str, n: int = 70) -> None:
    reader = PdfReader(path)
    page = reader.pages[0]
    print(f"\n===== {path} default =====")
    text = page.extract_text() or ""
    for i, line in enumerate(text.splitlines()[:n], 1):
        print(f"{i:03d}|{line}")
    print(f"\n===== {path} layout =====")
    try:
        layout = page.extract_text(extraction_mode="layout") or ""
    except TypeError:
        print("layout mode unsupported")
        return
    for i, line in enumerate(layout.splitlines()[:n], 1):
        print(f"{i:03d}|{line}")


dump("Injury-Report_2025-12-06_05PM.pdf", 60)
dump("Injury-Report_2023-10-24_05PM.pdf", 45)
dump("Injury-Report_2026-03-18_05_30PM.pdf", 50)
