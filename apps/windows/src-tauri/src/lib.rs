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
        .invoke_handler(tauri::generate_handler![allow_folder])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
