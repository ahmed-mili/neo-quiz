/* ══════════════════════════════════════════════════════════
   TRAVAILLEUR ÉLEVÉ DU BOOTSTRAPPER

   L'interface reste au niveau de l'utilisateur. Seul ce processus, lancé par
   Windows après l'UAC, télécharge puis exécute le NSIS machine. Il ne rend
   aucune fenêtre : son unique sortie est le tube nommé créé par le processus
   non élevé, ce qui permet à celui-ci de garder l'interface et de relancer
   Neo Quiz SANS lui transmettre les droits administrateur.
══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { argumentsNsis, resoudrePaquet, type PaquetInstallable } from "./noyau";
import type {
	ChargeTravailleur,
	CodeErreurInstallateur,
	CommandeTravailleur,
	MessageTravailleur,
} from "./protocole";

const USER_AGENT = "Neo-Quiz-Installer";
const MAX_REDIRECTIONS = 5;

class ErreurTravailleur extends Error {
	constructor(readonly code: CodeErreurInstallateur) {
		super(code);
	}
}

function paquetValide(value: unknown): value is PaquetInstallable {
	if (!value || typeof value !== "object") return false;
	const p = value as Record<string, unknown>;
	if (typeof p.version !== "string" || typeof p.nom !== "string" || typeof p.url !== "string" ||
		typeof p.taille !== "number" || typeof p.sha256 !== "string") return false;
	const reconstruit = resoudrePaquet({
		tag_name: `desktop-v${p.version}`,
		draft: false,
		prerelease: false,
		assets: [{
			name: p.nom,
			browser_download_url: p.url,
			size: p.taille,
			digest: `sha256:${p.sha256}`,
		}],
	});
	return !!reconstruit && reconstruit.nom === p.nom && reconstruit.url === p.url &&
		reconstruit.taille === p.taille && reconstruit.sha256 === p.sha256;
}

function decoderCharge(encoded: string): ChargeTravailleur | null {
	try {
		const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
		if (!value || typeof value !== "object") return null;
		const v = value as Record<string, unknown>;
		if (typeof v.secret !== "string" || !/^[0-9a-f]{64}$/i.test(v.secret)) return null;
		if (typeof v.dossier !== "string" || !isAbsolute(v.dossier)) return null;
		const dossier = resolve(v.dossier);
		/* Un dossier racine (`C:\`) transformerait un installateur d'application
		   en écrivain général du volume. Le choix explicite d'un sous-dossier
		   garde la portée de l'élévation étroite. */
		if (parse(dossier).root === dossier) return null;
		if (!paquetValide(v.paquet)) return null;
		return { secret: v.secret, dossier, paquet: v.paquet };
	} catch {
		return null;
	}
}

function hoteTelechargementAutorise(url: URL): boolean {
	return url.protocol === "https:" &&
		(url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com"));
}

async function ouvrirReponse(url: URL, signal: AbortSignal, redirections = 0): Promise<IncomingMessage> {
	if (!hoteTelechargementAutorise(url) || redirections > MAX_REDIRECTIONS) {
		throw new ErreurTravailleur("network");
	}
	return await new Promise<IncomingMessage>((resolvePromise, reject) => {
		const requete = get(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" } }, reponse => {
			const code = reponse.statusCode ?? 0;
			if (code >= 300 && code < 400 && reponse.headers.location) {
				reponse.resume();
				let suivante: URL;
				try {
					suivante = new URL(reponse.headers.location, url);
				} catch {
					reject(new ErreurTravailleur("network"));
					return;
				}
				void ouvrirReponse(suivante, signal, redirections + 1).then(resolvePromise, reject);
				return;
			}
			if (code !== 200) {
				reponse.resume();
				reject(new ErreurTravailleur("network"));
				return;
			}
			resolvePromise(reponse);
		});
		requete.once("error", erreur => {
			if (signal.aborted) reject(erreur);
			else reject(new ErreurTravailleur("network"));
		});
	});
}

async function telecharger(
	paquet: PaquetInstallable,
	destination: string,
	signal: AbortSignal,
	surProgression: (recus: number) => void,
): Promise<void> {
	const reponse = await ouvrirReponse(new URL(paquet.url), signal);
	const hash = createHash("sha256");
	let recus = 0;
	let dernierEnvoi = 0;
	const observer = new Transform({
		transform(morceau: Buffer, _encodage, rappel) {
			recus += morceau.length;
			hash.update(morceau);
			const maintenant = Date.now();
			if (maintenant - dernierEnvoi >= 100 || recus === paquet.taille) {
				dernierEnvoi = maintenant;
				surProgression(recus);
			}
			rappel(null, morceau);
		},
	});
	await pipeline(reponse, observer, createWriteStream(destination, { flags: "wx" }), { signal });
	if (recus !== paquet.taille || hash.digest("hex").toLowerCase() !== paquet.sha256) {
		throw new ErreurTravailleur("integrity");
	}
}

async function lancerNsis(
	installeur: string,
	dossier: string,
	surProgression: (pourcent: number) => void,
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const enfant = spawn(installeur, argumentsNsis(dossier), {
			windowsHide: true,
			stdio: "ignore",
		});
		/* NSIS 26 est lancé en `/S` et n'expose aucune progression de
		   décompression au processus parent. On ne fabrique donc pas un faux
		   pourcentage de fichiers : la jauge indique seulement l'AVANCEMENT
		   TEMPOREL de l'étape, borné à 96 %, puis passe à 100 % uniquement quand
		   NSIS rend réellement un code 0. Ce qui se perd : ce pourcentage ne peut
		   pas être interprété comme « x % des octets installés ». */
		const debut = Date.now();
		let dernier = -1;
		const publier = (pourcent: number): void => {
			const borne = Math.max(0, Math.min(100, Math.round(pourcent * 10) / 10));
			if (borne <= dernier) return;
			dernier = borne;
			surProgression(borne);
		};
		publier(0);
		const minuterie = setInterval(() => {
			const ecoulees = Date.now() - debut;
			publier(Math.min(96, 96 * (1 - Math.exp(-ecoulees / 5200))));
		}, 120);
		const terminer = (): void => clearInterval(minuterie);
		enfant.once("error", () => {
			terminer();
			reject(new ErreurTravailleur("installation"));
		});
		enfant.once("exit", code => {
			terminer();
			if (code === 0) {
				publier(100);
				resolvePromise();
			} else {
				reject(new ErreurTravailleur("installation"));
			}
		});
	});
}

async function ouvrirTube(nom: string): Promise<Socket> {
	return await new Promise<Socket>((resolvePromise, reject) => {
		const socket = connect(nom);
		socket.once("connect", () => resolvePromise(socket));
		socket.once("error", reject);
	});
}

function envoyer(socket: Socket, message: MessageTravailleur): void {
	socket.write(`${JSON.stringify(message)}\n`);
}

function ecouterCommandes(socket: Socket, surCommande: (commande: CommandeTravailleur) => void): void {
	let reste = "";
	socket.setEncoding("utf8");
	socket.on("data", morceau => {
		reste += morceau;
		for (;;) {
			const fin = reste.indexOf("\n");
			if (fin < 0) break;
			const ligne = reste.slice(0, fin);
			reste = reste.slice(fin + 1);
			try {
				const valeur: unknown = JSON.parse(ligne);
				if (valeur && typeof valeur === "object" && (valeur as { type?: unknown }).type === "annuler") {
					surCommande({ type: "annuler" });
				}
			} catch {
				/* Un message IPC corrompu ne doit jamais devenir une commande : le
				   tube est ignoré jusqu'à la prochaine ligne valide. */
			}
		}
	});
}

async function terminerTube(socket: Socket): Promise<void> {
	await new Promise<void>(resolvePromise => socket.end(resolvePromise));
}

/** Point d'entrée appelé par `main.ts` quand le portable a été relancé avec
    le drapeau privé du travailleur. Retourne un code de processus, sans jamais
    afficher de chaîne brute à l'utilisateur. */
export async function executerTravailleur(nomTube: string, chargeEncodee: string): Promise<number> {
	const charge = decoderCharge(chargeEncodee);
	if (!charge) return 2;

	let socket: Socket;
	try {
		socket = await ouvrirTube(nomTube);
	} catch {
		return 3;
	}
	envoyer(socket, { type: "auth", secret: charge.secret });

	const annulation = new AbortController();
	let installationCommencee = false;
	ecouterCommandes(socket, commande => {
		if (commande.type === "annuler" && !installationCommencee) annulation.abort();
	});

	const temporaire = await mkdtemp(join(tmpdir(), "neo-quiz-installer-"));
	const cheminPaquet = join(temporaire, charge.paquet.nom);
	try {
		await telecharger(charge.paquet, cheminPaquet, annulation.signal, recus => {
			envoyer(socket, { type: "telechargement", recus, total: charge.paquet.taille });
		});
		if (annulation.signal.aborted) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}

		envoyer(socket, { type: "verification" });
		installationCommencee = true;
		await lancerNsis(cheminPaquet, charge.dossier, pourcent => {
			envoyer(socket, { type: "installation", pourcent });
		});

		const executable = join(charge.dossier, "neo-quiz.exe");
		try {
			await access(executable);
		} catch {
			throw new ErreurTravailleur("installation");
		}
		envoyer(socket, { type: "termine", executable });
		await terminerTube(socket);
		return 0;
	} catch (erreur) {
		if (annulation.signal.aborted && !installationCommencee) {
			envoyer(socket, { type: "annule" });
			await terminerTube(socket);
			return 0;
		}
		const code = erreur instanceof ErreurTravailleur ? erreur.code : "generic";
		envoyer(socket, { type: "erreur", code });
		await terminerTube(socket);
		return 1;
	} finally {
		await rm(temporaire, { recursive: true, force: true });
		/* `dirname` est volontairement touché ici par le typechecker via cet
		   import utilisé : il rappelle que `cheminPaquet` reste dans notre
		   dossier temporaire et n'est jamais supprimé par un chemin reçu. */
		void dirname(cheminPaquet);
	}
}
