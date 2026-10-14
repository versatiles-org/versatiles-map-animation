/**
 * Manage the users file of the render server.
 *
 *   node passwd.mjs add <name>       add a user, or set a new password (asked for)
 *   node passwd.mjs remove <name>    remove a user
 *   node passwd.mjs list             list the users
 *
 * The file is the one the server uses: `$USERS_FILE`, or `users.txt` in
 * `$DATA_DIR` (default `server/data/`). The server notices the change by
 * itself within a few seconds; `kill -HUP` makes it read the file at once.
 * The password can also come on stdin, for scripts:
 *
 *   echo 'secret' | node passwd.mjs add alice
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

import { formatUser, hashPassword, parseUsers, USER_NAME } from './auth.mjs';
import { loadConfig } from './server.mjs';

/** Ask for a password without showing it, or read it from stdin. */
async function askPassword(prompt) {
	if (!process.stdin.isTTY) {
		const lines = createInterface({ input: process.stdin });
		for await (const line of lines) return line;
		return '';
	}
	process.stdout.write(prompt);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	let password = '';
	return new Promise((resolve, reject) => {
		const onData = (/** @type {Buffer} */ data) => {
			for (const char of data.toString('utf8')) {
				if (char === '\r' || char === '\n') {
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdin.off('data', onData);
					process.stdout.write('\n');
					resolve(password);
					return;
				}
				if (char === '\u0003') {
					process.stdout.write('\n');
					reject(new Error('cancelled'));
					return;
				}
				if (char === '\u007f') password = password.slice(0, -1);
				else password += char;
			}
		};
		process.stdin.on('data', onData);
	});
}

async function main() {
	const [command, name] = process.argv.slice(2);
	const { usersFile } = loadConfig();
	let text = '';
	try {
		text = await readFile(usersFile, 'utf8');
	} catch {
		// No file yet.
	}
	const lines = text.split(/\r?\n/).filter((line, i, all) => line !== '' || i < all.length - 1);
	const lineOf = (/** @type {string} */ user) =>
		lines.findIndex((l) => l.trim().startsWith(user + ':'));

	if (command === 'list') {
		const { users } = parseUsers(text);
		console.log(users.size ? [...users.keys()].join('\n') : `(no users in ${usersFile})`);
		return;
	}
	if ((command !== 'add' && command !== 'remove') || !name) {
		console.log('usage: node passwd.mjs add <name> | remove <name> | list');
		process.exitCode = 1;
		return;
	}
	if (!USER_NAME.test(name)) throw new Error('a name has letters, digits and _ . @ - only');

	if (command === 'remove') {
		const i = lineOf(name);
		if (i < 0) throw new Error(`no user ${name} in ${usersFile}`);
		lines.splice(i, 1);
	} else {
		const password = await askPassword(`password for ${name}: `);
		if (password.length < 8) throw new Error('the password needs at least 8 characters');
		if (process.stdin.isTTY && (await askPassword('again: ')) !== password) {
			throw new Error('the two passwords differ');
		}
		const line = formatUser(name, await hashPassword(password));
		const i = lineOf(name);
		if (i >= 0) lines[i] = line;
		else lines.push(line);
	}
	await mkdir(dirname(usersFile), { recursive: true });
	await writeFile(usersFile, lines.join('\n') + '\n', { mode: 0o600 });
	console.log(`${command === 'add' ? 'saved' : 'removed'} ${name} in ${usersFile}`);
}

main().catch((err) => {
	console.error(`error: ${err.message}`);
	process.exit(1);
});
