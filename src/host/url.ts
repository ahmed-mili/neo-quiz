/** Une adresse que l'hôte accepte d'ouvrir dans le navigateur : `https:`
    seulement. Partagée par les deux hôtes pour que la règle n'ait qu'une
    source ; le principal Electron refuserait aussi le reste, mais une garde
    ici rend un `false` net au lieu d'un avertissement dans la console. */
export function estUrlHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}
