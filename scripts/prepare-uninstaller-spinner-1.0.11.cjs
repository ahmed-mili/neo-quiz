const fs = require('node:fs');

const p = 'scripts/check-package.mjs';
let s = fs.readFileSync(p, 'utf8');
const re = /r\.check\("désinstallation : barre plate fidèle avec progression et pourcentage",[\s\S]*?\);\nr\.check\("author\.name est celui attendu par winget et SignPath"/;
const replacement = `r.check("désinstallation : fenêtre d'attente avec spinner, sans barre de progression",
\t[
\t\tconfig.nsis?.oneClick,
\t\tconfig.nsis?.perMachine,
\t\tuninstallerNsis.includes("removeDefaultUninstallWelcomePage"),
\t\tuninstallerNsis.includes("MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte"),
\t\tuninstallerNsis.includes("Désinstallation en cours..."),
\t\tuninstallerNsis.includes("\${NSD_CreateTimer} un.NeoQuizAnimerSpinner 90"),
\t\tuninstallerNsis.includes("SetCtlColors $NeoQuizDialogueProgression FFFFFF 202124"),
\t\tuninstallerNsis.includes('"◐"'),
\t\tuninstallerNsis.includes("PBM_GETPOS"),
\t\tuninstallerNsis.includes("NeoQuizBarreProgression"),
\t\tuninstallerNsis.includes('"STR:$R2%"'),
\t],
\t[false, true, true, true, true, true, true, true, false, false, false]);
r.check("author.name est celui attendu par winget et SignPath"`;

if (!re.test(s)) {
  throw new Error('Bloc de contrôle désinstallation 1.0.10 introuvable');
}
s = s.replace(re, replacement);
fs.writeFileSync(p, s, 'utf8');
