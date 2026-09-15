from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/windows/installer/main.ts"
s = p.read_text(encoding="utf-8")
broken = "\n jusqu'au signal\n    explicite `fenetre.prete()` envoyé après l'initialisation du rendu."
fixed = "\n/** L'application garde maintenant sa vraie fenêtre CACHÉE jusqu'au signal\n    explicite `fenetre.prete()` envoyé après l'initialisation du rendu."
if broken in s:
    s = s.replace(broken, fixed, 1)
p.write_text(s, encoding="utf-8")
