use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Autorise l'application à lire un dossier choisi par l'utilisateur.
///
/// PIÈGE — Tauri tient DEUX portées séparées, et il faut les ouvrir TOUTES LES
/// DEUX : celle du greffon `fs` (lecture et écriture des notes) et celle du
/// protocole `asset` (les images des quiz, servies par `convertFileSrc`).
/// N'en ouvrir qu'une donne une application qui lit les notes, affiche la liste
/// des quiz… et n'affiche AUCUNE image, sans le moindre message d'erreur : le
/// protocole refuse la requête en silence, la console reste vide, et rien ne
/// désigne la cause. Ne « simplifiez » donc jamais cette fonction en retirant
/// l'un des deux appels.
///
/// Les portées ne survivent pas au redémarrage (elles vivent en mémoire, pas
/// sur le disque) : le frontend rappelle cette commande à CHAQUE lancement,
/// avec le dossier qu'il a persisté, même s'il ne vient pas de le choisir.
///
/// `asset_protocol_scope()` n'existe que si la caisse `tauri` est compilée avec
/// la fonctionnalité `protocol-asset` — voir `Cargo.toml`. Sans elle, ce code
/// ne compile pas ; c'est le seul garde-fou mécanique dont on dispose ici.
#[tauri::command]
fn allow_folder(app: tauri::AppHandle, chemin: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&chemin, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&chemin, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Un vault Obsidian connu de la machine.
#[derive(serde::Serialize)]
struct VaultConnu {
    chemin: String,
    nom: String,
}

/// Les vaults qu'Obsidian connaît sur cette machine.
///
/// Obsidian tient leur liste dans `%APPDATA%/obsidian/obsidian.json`. La lire
/// EN RUST plutôt que depuis le frontend n'est pas un caprice : la portée du
/// greffon `fs` ne couvre que le dossier choisi par l'utilisateur, et l'ouvrir
/// jusqu'au dossier de configuration d'Obsidian pour lire un seul fichier
/// donnerait à la fenêtre bien plus de droits qu'elle n'en a besoin.
///
/// Un vault dont le dossier a disparu est ÉCARTÉ : le proposer mènerait à une
/// liste de quiz vide sans que rien n'explique pourquoi. Une liste vide est
/// donc un état normal — pas une erreur — et le frontend n'affiche alors que
/// le sélecteur natif.
#[tauri::command]
fn obsidian_vaults() -> Vec<VaultConnu> {
    let Some(base) = dirs_appdata() else {
        return Vec::new();
    };
    let fichier = base.join("obsidian").join("obsidian.json");
    let Ok(texte) = std::fs::read_to_string(&fichier) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&texte) else {
        return Vec::new();
    };
    let mut trouves = Vec::new();
    if let Some(vaults) = json.get("vaults").and_then(|v| v.as_object()) {
        for (_, v) in vaults {
            let Some(chemin) = v.get("path").and_then(|p| p.as_str()) else {
                continue;
            };
            let p = std::path::Path::new(chemin);
            // Le dossier doit exister ET porter un `.obsidian` : un chemin
            // encore listé après un déplacement n'est plus un vault.
            if !p.join(".obsidian").is_dir() {
                continue;
            }
            let nom = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(chemin)
                .to_string();
            trouves.push(VaultConnu {
                chemin: chemin.to_string(),
                nom,
            });
        }
    }
    trouves.sort_by(|a, b| a.nom.to_lowercase().cmp(&b.nom.to_lowercase()));
    trouves
}

/// `%APPDATA%` (Roaming). `std::env::var` suffit : Tauri n'expose que le
/// dossier de données de l'APPLICATION, pas celui d'un autre logiciel.
fn dirs_appdata() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(std::path::PathBuf::from)
}

/// Point d'entrée de l'application.
///
/// Les greffons servent le frontend : `fs` (index et lecture des notes),
/// `dialog` (le sélecteur de dossier natif), `store` (le dossier retenu d'une
/// session à l'autre) et `opener` (ouvrir une ressource avec l'application par
/// défaut du système). `allow_folder` est la SEULE commande native de la
/// tranche 1.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![allow_folder, obsidian_vaults])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
