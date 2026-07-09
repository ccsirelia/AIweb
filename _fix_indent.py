from pathlib import Path
import ast

path = Path("backend/routes/chat.py")
text = path.read_text(encoding="utf-8")
# normalize CRLF for processing
normalized = text.replace("\r\n", "\n")
lines = normalized.split("\n")

for i, line in enumerate(lines):
    if line.strip() == "service = OpenAIService(provider=job.provider)" and line.startswith(" "):
        lines[i] = "        service = OpenAIService(provider=job.provider)"
    if line.strip() == "try:" and i + 1 < len(lines) and "provider=payload.provider" in lines[i + 1]:
        lines[i] = "    try:"

new_text = "\n".join(lines)
if text.endswith("\n") and not new_text.endswith("\n"):
    new_text += "\n"
# keep original newline style if file used CRLF
if "\r\n" in text:
    new_text = new_text.replace("\n", "\r\n")
path.write_text(new_text, encoding="utf-8")
ast.parse(path.read_text(encoding="utf-8"))
print("OK")
for n in [200, 343]:
    print(n, repr(path.read_text(encoding="utf-8").splitlines()[n - 1]))
