/**
 * Le noyau pur des vidéos YouTube : les liens d'un texte, le choix de la
 * piste de sous-titres dans la langue d'origine, le texte propre d'un
 * json3, et le document markdown joint à la demande. Sans Node, sans DOM,
 * sans Obsidian : les applications PC et Android l'importent tel quel.
 */

export * from "./youtube";
export * from "./piste";
export * from "./texte";
export * from "./document";