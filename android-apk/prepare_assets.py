#!/usr/bin/env python3
"""Copy the offline Creator Studio and student portal into the APK assets."""
import os
from pathlib import Path

root = Path(__file__).resolve().parent
src = Path(os.environ.get("STUDIO_DIR", root.parent / "public" / "studio"))
dst = root / "assets" / "www"
dst.mkdir(parents=True, exist_ok=True)

session = """<script>
try{
  if(!localStorage.getItem('ia_quiz_mobile_v1u_c')) localStorage.setItem('ia_quiz_mobile_v1u_c','{"r":"c","id":1}');
  if(!localStorage.getItem('ia_quiz_mobile_v1u_s')) localStorage.setItem('ia_quiz_mobile_v1u_s','{"r":"s","id":1,"s":1}');
}catch(e){}
</script>"""

chip = """<script>
document.addEventListener('DOMContentLoaded',function(){
  var admin=/creator\\.html/.test(location.pathname);
  var a=document.createElement('a');
  a.href=admin?'student.html':'creator.html';
  a.textContent=admin?'Student view':'Admin studio';
  a.setAttribute('aria-label', admin?'Open the student portal':'Open Creator Studio as admin');
  a.style.cssText='position:fixed;z-index:80;left:12px;bottom:calc(78px + env(safe-area-inset-bottom,0px));background:#0b4f9c;color:#fff;text-decoration:none;font:600 14px/1 system-ui,sans-serif;padding:14px 16px;border-radius:999px;box-shadow:0 6px 18px rgba(11,79,156,.35);min-height:44px;display:inline-flex;align-items:center';
  document.body.appendChild(a);
});
</script>"""

for name in ("creator.html", "student.html"):
    text = (src / name).read_text(encoding="utf-8")
    text = text.replace("<head>", "<head>" + session, 1)
    text = text.replace("</body>", chip + "</body>", 1)
    (dst / name).write_text(text, encoding="utf-8")

(dst / "index.html").write_text(
    """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>INSPIRE Academy</title>
<meta name="theme-color" content="#0b4f9c">
<script>
try{
  if(!localStorage.getItem('ia_quiz_mobile_v1u_c')) localStorage.setItem('ia_quiz_mobile_v1u_c','{"r":"c","id":1}');
  if(!localStorage.getItem('ia_quiz_mobile_v1u_s')) localStorage.setItem('ia_quiz_mobile_v1u_s','{"r":"s","id":1,"s":1}');
}catch(e){}
location.replace('creator.html');
</script>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#e7eef6;font-family:system-ui,sans-serif">
<p>Opening Creator Studio…</p>
</body>
</html>
""",
    encoding="utf-8",
)
print("assets ready", dst)
