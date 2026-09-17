from pypdf import PdfReader


def layout_lines(path: str) -> list[str]:
    reader = PdfReader(path)
    lines = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout") or ""
        lines.extend(" ".join(x.split()) for x in text.splitlines() if x.strip())
    return lines


def find(lines: list[str], needle: str) -> list[str]:
    n = needle.lower()
    return [x for x in lines if n in x.lower()]


am = layout_lines("Injury-Report_2025-12-06_11AM.pdf")
pm = layout_lines("Injury-Report_2025-12-06_05PM.pdf")
for name in ["Jones, Herbert", "Missi, Yves", "Clowney", "Williamson", "NOT YET SUBMITTED", "Available"]:
    print("\n====", name, "====")
    print("11AM", find(am, name)[:6])
    print("05PM", find(pm, name)[:6])

print("\n11AM line count", len(am), "Available hits", len(find(am, "Available")))
print("05PM line count", len(pm), "Available hits", len(find(pm, "Available")))
print("11AM NYS", len(find(am, "NOT YET SUBMITTED")), "05PM NYS", len(find(pm, "NOT YET SUBMITTED")))
