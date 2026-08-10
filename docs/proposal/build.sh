#!/usr/bin/env bash
# Build the RISTEK Hackathon 2026 preliminary proposal and verify that the
# output obeys every rule in the guidebook's Format Guideline table.
#
#   ./build.sh
#
# Produces  Preliminary_RistekHackathon2026_<TeamName>.pdf  in this directory.
set -euo pipefail
cd "$(dirname "$0")"

command -v tectonic >/dev/null || { echo "tectonic not found. Install with: brew install tectonic"; exit 1; }

echo "==> compiling"
tectonic -X compile main.tex >/dev/null 2>&1 || tectonic -X compile main.tex

# Derive the submission filename from teaminfo.tex so it can never drift.
TEAM=$(sed -n 's/^\\newcommand{\\TeamName}{\(.*\)}$/\1/p' teaminfo.tex)
SAFE=$(printf '%s' "$TEAM" | tr -cd '[:alnum:]_ -' | tr ' ' '_')
OUT="Preliminary_RistekHackathon2026_${SAFE}.pdf"
cp main.pdf "$OUT"
echo "==> wrote $OUT"

echo "==> verifying"
python3 - "$OUT" <<'PY'
import subprocess, re, sys
PDF = sys.argv[1]

def run(*args):
    # List form, never shell=True: the team name reaches this as a filename.
    return subprocess.run(list(args), capture_output=True, text=True).stdout

W, H = 595.275590551, 841.88976378
PT = W / 21.0
info = run('pdfinfo', PDF)
pages = int(re.search(r'Pages:\s+(\d+)', info).group(1))
fails = []

def check(label, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  {detail}" if detail else ""))
    if not cond:
        fails.append(label)

fonts = [l.split()[0].split('+')[-1]
         for l in run('pdffonts', PDF).strip().split("\n")[2:] if l.strip()]
check("Font is Times New Roman only",
      bool(fonts) and all('TimesNewRoman' in f for f in fonts), ", ".join(sorted(set(fonts))))

check("Page size A4", '595.28 x 841.89' in info)

body = next((p - 2 for p in range(2, pages + 1)
             if 'References' in run('pdftotext', '-f', str(p), '-l', str(p), PDF, '-')), None)
check("Body within 10-page limit", body is not None and body <= 10,
      f"body={body} pages, total={pages}")

missing = [p for p in range(1, pages + 1)
           if len([l for l in run('pdfimages', '-list', '-f', str(p), '-l', str(p), PDF)
                   .strip().split("\n")[2:] if l.strip()]) < 3]
check("Logo on every page", not missing, f"pages missing: {missing or 'none'}")

pgs = re.split(r'<page ', run('pdftotext', '-bbox', PDF, '-'))[1:]
L, R, nums = [], [], []
for i, pg in enumerate(pgs, 1):
    ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
    if not ws or i == 1:
        continue
    bodyw = [(float(a), float(c)) for a, b, c, d, e in ws if float(d) < 770]
    if bodyw:
        L.append(min(x[0] for x in bodyw))
        R.append(W - max(x[1] for x in bodyw))
    low = max(ws, key=lambda w: float(w[3]))
    if low[4].strip().isdigit():
        nums.append(((W - float(low[2])) / PT, (H - float(low[3])) / PT))

check("Margins are 3 cm", min(L) / PT > 2.97 and min(R) / PT > 2.97,
      f"left={min(L)/PT:.2f}cm right={min(R)/PT:.2f}cm")
check("Page numbers bottom-right", bool(nums) and all(abs(r - 3.0) < 0.08 for r, _ in nums),
      f"{len(nums)} numbered pages at {nums[0][0]:.2f}cm from right")

if '«' in run('pdftotext', PDF, '-'):
    print("\n  !! WARNING: placeholder «...» text is still present. Edit teaminfo.tex.")

print("\n" + ("ALL FORMAT CHECKS PASSED" if not fails else f"FAILED: {fails}"))
sys.exit(1 if fails else 0)
PY
