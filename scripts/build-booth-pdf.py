#!/usr/bin/env python3
"""Build the printable Talk-Active booth one-pager and large QR card."""

from pathlib import Path

from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, A5
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output" / "pdf"
TMP = ROOT / "tmp" / "pdfs"
PRODUCT_URL = "https://talk-active-id.vercel.app"

INK = HexColor("#171A16")
MUTED = HexColor("#667064")
PAPER = HexColor("#FAF9F0")
PAPER_2 = HexColor("#F2F0E8")
GREEN = HexColor("#1E4A19")
GREEN_2 = HexColor("#2F6A25")
WASH = HexColor("#E7F0E2")
BLUE = HexColor("#1984A6")
BLUE_WASH = HexColor("#DDF1F6")
YELLOW = HexColor("#F4C72F")
WHITE = HexColor("#FFFFFF")
LINE = HexColor("#D8DCCF")


def wrap(text, font, size, width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(c, text, x, top, width, font="Helvetica", size=10, leading=None, color=INK, max_lines=None):
    leading = leading or size * 1.28
    lines = wrap(text, font, size, width)
    if max_lines:
        lines = lines[:max_lines]
    c.setFillColor(color)
    c.setFont(font, size)
    for index, line in enumerate(lines):
        c.drawString(x, top - (index * leading), line)
    return top - len(lines) * leading


def image_contain(c, source, x, y, width, height):
    with Image.open(source) as image:
        iw, ih = image.size
    scale = min(width / iw, height / ih)
    w = iw * scale
    h = ih * scale
    c.drawImage(ImageReader(str(source)), x + (width - w) / 2, y + (height - h) / 2, w, h, mask="auto")


def rounded(c, x, y, width, height, fill, stroke=LINE, radius=12, line_width=0.8):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(line_width)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def label(c, text, x, y, color=GREEN_2, size=7.5):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, text.upper())


def step(c, number, heading, copy, x, y, width, height, accent=GREEN):
    rounded(c, x, y, width, height, PAPER_2, LINE, 9)
    c.setFillColor(YELLOW)
    c.circle(x + 15, y + height - 16, 9, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x + 15, y + height - 18.5, str(number))
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 31, y + height - 19, heading)
    paragraph(c, copy, x + 11, y + height - 36, width - 22, "Helvetica", 7.6, 9.2, MUTED, 2)


def setup(c, title, pagesize):
    c.setTitle(title)
    c.setAuthor("Team FAM")
    c.setSubject("Talk-Active RISTEK Hackathon 2026 booth material")
    c.setCreator("Team FAM")
    c.setPageSize(pagesize)


def build_one_pager(destination):
    width, height = A4
    c = canvas.Canvas(str(destination), pagesize=A4, pageCompression=1)
    setup(c, "Talk-Active Booth One-Pager", A4)
    c.setFillColor(PAPER)
    c.rect(0, 0, width, height, fill=1, stroke=0)

    margin = 36
    mascot = TMP / "mascot-print.png"
    official = ROOT / "docs" / "proposal" / "assets" / "logos" / "ristek.png"
    qr = ROOT / "docs" / "booth" / "assets" / "talk-active-production-qr.png"

    # Header
    image_contain(c, mascot, margin, height - 60, 36, 36)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(margin + 44, height - 42, "Talk-")
    active_x = margin + 44 + stringWidth("Talk-", "Helvetica-Bold", 17)
    c.setFillColor(GREEN_2)
    c.drawString(active_x, height - 42, "Active")
    label(c, "RISTEK Hackathon 2026 Grand Final - Team FAM", margin + 44, height - 56, MUTED, 6.8)
    rounded(c, width - margin - 153, height - 64, 153, 40, WHITE, LINE, 8)
    image_contain(c, official, width - margin - 144, height - 56, 135, 23)

    # Hero
    label(c, "Rubric-grounded rehearsal", margin, height - 91, GREEN_2, 8)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 29)
    title_lines = ["Bring the rubric.", "Find the sentence", "the judge will challenge."]
    for index, line in enumerate(title_lines):
        c.drawString(margin, height - 123 - (index * 31), line)
    paragraph(
        c,
        "Talk-Active turns one published rubric and one rehearsal into cited evidence, the hardest likely question, and saved progress.",
        margin,
        height - 222,
        350,
        "Helvetica",
        11,
        15,
        MUTED,
        3,
    )
    image_contain(c, mascot, width - margin - 130, height - 235, 125, 135)

    # Loop
    label(c, "The product loop", margin, height - 272, GREEN_2, 8)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(margin, height - 292, "One event stays connected from rubric to progress.")
    gap = 8
    card_width = (width - (2 * margin) - (2 * gap)) / 3
    cards = [
        (1, "Project", "Keep the event, rubric and attempts together."),
        (2, "Rubric", "Paste real evaluator criteria or a scoring matrix."),
        (3, "Attempt", "Dictate or paste one rehearsal answer."),
        (4, "Evidence", "See an exact quote or the missing cues."),
        (5, "Defend", "Answer the hardest likely judge question."),
        (6, "Progress", "Save the gap and retry that criterion."),
    ]
    for index, (number, heading, copy) in enumerate(cards):
        col = index % 3
        row = index // 3
        x = margin + col * (card_width + gap)
        y = height - 366 - row * 65
        step(c, number, heading, copy, x, y, card_width, 56, BLUE if number == 4 else GREEN)

    # Evidence card
    evidence_y = height - 523
    rounded(c, margin, evidence_y, width - 2 * margin, 93, BLUE_WASH, BLUE, 13, 1.2)
    c.setFillColor(BLUE)
    c.rect(margin, evidence_y + 9, 5, 75, fill=1, stroke=0)
    label(c, "Innovation & uniqueness", margin + 18, evidence_y + 69, BLUE, 7.5)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawRightString(width - margin - 18, evidence_y + 69, "evidence found")
    c.setFillColor(INK)
    c.setFont("Times-Roman", 17)
    c.drawString(margin + 18, evidence_y + 42, '"A supporting verdict disappears if it cannot quote the transcript."')
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(margin + 18, evidence_y + 19, "your words, from this attempt")

    # Bottom left: current scope and boundary
    lower_y = 105
    lower_h = evidence_y - lower_y - 14
    left_w = 312
    rounded(c, margin, lower_y, left_w, lower_h, GREEN, GREEN, 13)
    label(c, "Working today", margin + 18, lower_y + lower_h - 25, YELLOW, 7.5)
    current = [
        "Public-rubric projects and editable criteria",
        "Pasted or dictated attempts",
        "Semantic mapping with visible deterministic fallback",
        "Device-local saved progress",
    ]
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 8.7)
    line_y = lower_y + lower_h - 46
    for item in current:
        c.setFillColor(YELLOW)
        c.circle(margin + 21, line_y + 2, 2.2, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.drawString(margin + 31, line_y, item)
        line_y -= 17
    label(c, "Honest boundary", margin + 18, line_y - 5, YELLOW, 7.5)
    paragraph(
        c,
        "Evidence coverage is not a confidence or speaking-ability score. Raw audio is not persisted. Public rubrics come first.",
        margin + 18,
        line_y - 23,
        left_w - 36,
        "Helvetica",
        8.4,
        11,
        WHITE,
        4,
    )

    # Bottom right: QR
    qr_x = margin + left_w + 12
    qr_w = width - margin - qr_x
    rounded(c, qr_x, lower_y, qr_w, lower_h, WHITE, LINE, 13)
    label(c, "Try it now", qr_x + 15, lower_y + lower_h - 25, GREEN_2, 7.5)
    qr_size = min(qr_w - 30, 126)
    c.drawImage(ImageReader(str(qr)), qr_x + (qr_w - qr_size) / 2, lower_y + 63, qr_size, qr_size, mask="auto")
    c.linkURL(PRODUCT_URL, (qr_x, lower_y, qr_x + qr_w, lower_y + lower_h), relative=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawCentredString(qr_x + qr_w / 2, lower_y + 45, "talk-active-id.vercel.app")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.6)
    c.drawCentredString(qr_x + qr_w / 2, lower_y + 29, "Public - no sign-in - reset between visitors")

    # Footer
    c.setStrokeColor(LINE)
    c.line(margin, 86, width - margin, 86)
    label(c, "Team FAM", margin, 66, GREEN_2, 7)
    c.setFillColor(INK)
    c.setFont("Helvetica", 7.2)
    c.drawString(margin, 51, "Sultan Ibnu Mansiz - Farrel Athalla Muljawan - Erdafa Andikri")
    c.drawString(margin, 39, "Ivan Jehuda Angi - Abhiseka Susanto")
    c.setFillColor(MUTED)
    c.drawRightString(width - margin, 51, "Education - Tech for Good")
    c.drawRightString(width - margin, 39, "RISTEK Hackathon 2026")

    c.showPage()
    c.save()


def build_qr_card(destination):
    width, height = A5
    c = canvas.Canvas(str(destination), pagesize=A5, pageCompression=1)
    setup(c, "Talk-Active Booth QR Card", A5)
    c.setFillColor(GREEN)
    c.rect(0, 0, width, height, fill=1, stroke=0)

    margin = 24
    mascot = TMP / "mascot-print.png"
    official = ROOT / "docs" / "proposal" / "assets" / "logos" / "ristek.png"
    qr = ROOT / "docs" / "booth" / "assets" / "talk-active-production-qr.png"

    image_contain(c, mascot, margin, height - 70, 40, 40)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(margin + 47, height - 46, "Talk-")
    active_x = margin + 47 + stringWidth("Talk-", "Helvetica-Bold", 18)
    c.setFillColor(YELLOW)
    c.drawString(active_x, height - 46, "Active")
    rounded(c, width - margin - 120, height - 64, 120, 34, WHITE, WHITE, 7)
    image_contain(c, official, width - margin - 112, height - 56, 104, 18)

    label(c, "Try the full rehearsal loop", margin, height - 97, YELLOW, 8)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 25)
    c.drawString(margin, height - 128, "Scan. Rehearse.")
    c.drawString(margin, height - 158, "Show the sentence.")

    qr_size = 90 * mm
    qr_x = (width - qr_size) / 2
    qr_y = height - 176 - qr_size
    rounded(c, qr_x - 8, qr_y - 8, qr_size + 16, qr_size + 16, WHITE, WHITE, 13)
    c.drawImage(ImageReader(str(qr)), qr_x, qr_y, qr_size, qr_size, mask="auto")
    c.linkURL(PRODUCT_URL, (qr_x - 8, qr_y - 8, qr_x + qr_size + 8, qr_y + qr_size + 8), relative=0)

    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, qr_y - 28, "talk-active-id.vercel.app")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, qr_y - 44, "Public - no sign-in - works on your phone")

    rounded(c, margin, 35, width - 2 * margin, 68, GREEN_2, GREEN_2, 12)
    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin + 17, 83, "NO QUOTE?")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(margin + 17, 59, "No supporting verdict.")
    c.setFont("Helvetica", 8.8)
    c.setFillColor(HexColor("#D7E8D2"))
    c.drawString(margin + 17, 43, "Evidence coverage - not confidence or speaking ability.")
    c.setFillColor(HexColor("#D7E8D2"))
    c.setFont("Helvetica-Bold", 7)
    c.drawRightString(width - margin, 15, "TEAM FAM - RISTEK HACKATHON 2026")

    c.showPage()
    c.save()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    with Image.open(ROOT / "src" / "assets" / "macaw-mascot-3d.webp") as image:
        image.thumbnail((360, 360), Image.Resampling.LANCZOS)
        image.save(TMP / "mascot-print.png", optimize=True)
    build_one_pager(OUTPUT / "Talk-Active_Booth_One-Pager_A4.pdf")
    build_qr_card(OUTPUT / "Talk-Active_Booth_QR_Card_A5.pdf")
    print("booth-pdf:")
    print("  status: ready")
    print(f'  one-pager: "{OUTPUT / "Talk-Active_Booth_One-Pager_A4.pdf"}"')
    print(f'  qr-card: "{OUTPUT / "Talk-Active_Booth_QR_Card_A5.pdf"}"')


if __name__ == "__main__":
    main()
