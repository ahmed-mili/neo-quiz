/* ══════════════════════════════════════════════════════════
   LA LANGUE DE L'INTERFACE — le réglage `language`

   `lireLangue` est PURE (aucun `pont()`, aucun DOM) : c'est elle que
   `scripts/check-langue.mjs` éprouve sur une valeur BRUTE lue du disque, qui
   peut avoir été écrite par le bootstrapper d'installation, par une autre
   version, ou à la main. Les deux autres passent par `pont()`, lu à l'APPEL
   — même règle que `reprise.ts`.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { CLE_REGLAGES_LANGUE } from "../../electron/pont";

export type LangueReglage = "auto" | "en" | "fr";

const LANGUES: readonly LangueReglage[] = ["auto", "en", "fr"];

/** Relit le réglage depuis une valeur brute : tout ce qui n'est pas l'une
    des trois valeurs vaut « auto » — jamais une erreur au démarrage. */
export function lireLangue(brut: unknown): LangueReglage {
	return typeof brut === "string" && (LANGUES as readonly string[]).includes(brut)
		? brut as LangueReglage
		: "auto";
}

export async function chargerLangue(): Promise<LangueReglage> {
	return lireLangue(await pont().reglages.lire(CLE_REGLAGES_LANGUE));
}

export async function reglerLangue(langue: LangueReglage): Promise<void> {
	await pont().reglages.ecrire(CLE_REGLAGES_LANGUE, langue);
}
