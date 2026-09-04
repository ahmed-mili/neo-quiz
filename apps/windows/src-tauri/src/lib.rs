/// Point d'entrée de l'application.
///
/// Volontairement vide pour l'instant : la tranche 1 fait tout depuis le
/// frontend. Les seules commandes natives prévues (extension des portées de
/// fichiers, tache 10) arrivent quand un dossier peut être choisi.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
