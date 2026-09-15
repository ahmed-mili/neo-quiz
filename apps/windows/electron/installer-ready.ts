import { connect } from "node:net";

/* Le bootstrapper reste visible tant que l'application installée n'a pas fini
   sa propre initialisation. Le drapeau n'est pas traduit : c'est un identifiant
   de protocole entre deux processus, au même titre qu'un nom de canal IPC. */
export const ARG_INSTALLER_READY = "--neo-quiz-installer-ready";

export interface SignalInstallateurPret {
	tube: string;
	secret: string;
}

/** Lit uniquement la forme créée par le bootstrapper. Refuser toute autre
    chaîne empêche un argument arbitraire de devenir une cible de connexion. */
export function lireSignalInstallateurPret(args: readonly string[]): SignalInstallateurPret | null {
	const index = args.indexOf(ARG_INSTALLER_READY);
	if (index < 0) return null;
	const tube = args[index + 1];
	const secret = args[index + 2];
	if (!tube || !/^\\\\\.\\pipe\\neo-quiz-ready-[0-9a-f-]{36}$/i.test(tube)) return null;
	if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) return null;
	return { tube, secret };
}

/** Signale au bootstrapper que la fenêtre est réellement prête à être montrée,
    puis attend son accusé avant de rendre Neo Quiz visible. Ainsi le panneau de
    démarrage disparaît avant la fenêtre de l'application, sans minuterie choisie
    à l'aveugle. Un bootstrapper disparu ne doit jamais bloquer l'application. */
export async function signalerInstallateurPret(signal: SignalInstallateurPret | null): Promise<void> {
	if (!signal) return;
	await new Promise<void>(resolvePromise => {
		const socket = connect(signal.tube);
		let termine = false;
		let reste = "";
		const terminer = (): void => {
			if (termine) return;
			termine = true;
			clearTimeout(garde);
			socket.destroy();
			resolvePromise();
		};
		const garde = setTimeout(terminer, 1800);
		socket.setEncoding("utf8");
		socket.once("connect", () => socket.write(`${signal.secret}\n`));
		socket.on("data", morceau => {
			reste += morceau;
			if (reste.includes("ok\n")) terminer();
		});
		socket.once("error", terminer);
		socket.once("close", terminer);
	});
}
