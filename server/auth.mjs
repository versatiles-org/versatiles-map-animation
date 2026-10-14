/**
 * Who may use the server: a plain text file of user names and password
 * hashes, and the sessions of those who have logged in.
 *
 * The file has one user per line, `name:scrypt:<salt>:<hash>` — written by
 * `passwd.mjs`, so no password is ever stored as it is. Empty lines and
 * lines starting with `#` are ignored. The file is read again whenever it
 * changes and on SIGHUP; a user who is no longer in it is logged out.
 *
 * Sessions live in memory: a restart of the server means logging in again.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFile, watchFile } from 'node:fs';
import { promisify } from 'node:util';

const scrypt = /** @type {(p: string, s: Buffer, n: number) => Promise<Buffer>} */ (
	promisify(scryptCallback)
);
const readText = promisify(readFile);

/** A user name: letters, digits and `_ . @ -`. */
export const USER_NAME = /^[\w.@-]{1,64}$/;

const SESSION_DAYS = 14;
/** Failed logins from one address before it has to wait, and for how long. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** The stored form of a password: `scrypt:<salt>:<hash>`, both base64url. */
export async function hashPassword(password) {
	const salt = randomBytes(16);
	const hash = await scrypt(password.normalize('NFC'), salt, 32);
	return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

/** Does `password` match the stored form `stored`? */
export async function verifyPassword(password, stored) {
	const [kind, salt, hash] = stored.split(':');
	if (kind !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64url');
	if (expected.length === 0) return false;
	const actual = await scrypt(
		password.normalize('NFC'),
		Buffer.from(salt, 'base64url'),
		expected.length
	);
	return timingSafeEqual(expected, actual);
}

/**
 * The users in the text of a users file, as name → stored password.
 * `problems` lists the lines that could not be read, by line number.
 */
export function parseUsers(text) {
	const users = new Map();
	const problems = [];
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (!line || line.startsWith('#')) return;
		const colon = line.indexOf(':');
		const name = line.slice(0, colon);
		const stored = line.slice(colon + 1);
		if (colon < 0 || !USER_NAME.test(name) || !stored.startsWith('scrypt:')) {
			problems.push(i + 1);
			return;
		}
		users.set(name, stored);
	});
	return { users, problems };
}

/** A line of the users file. */
export function formatUser(name, stored) {
	return `${name}:${stored}`;
}

// Checked against when a name is unknown, so that a wrong name takes as
// long as a wrong password and does not give away which names exist.
const DUMMY = hashPassword('');

export class Accounts {
	#file;
	#log;
	/** @type {Map<string, string>} */
	#users = new Map();
	/** @type {Map<string, { user: string, expires: number }>} */
	#sessions = new Map();
	/** @type {Map<string, { count: number, since: number }>} */
	#failures = new Map();

	/** `file` is the users file; `log` gets a line on every reload. */
	constructor(file, log = (/** @type {string} */ _msg) => {}) {
		this.#file = file;
		this.#log = log;
	}

	/** How many users there are. */
	get size() {
		return this.#users.size;
	}

	/** Read the users file (again). A missing file means: no users. */
	async load() {
		let text = '';
		try {
			text = await readText(this.#file, 'utf8');
		} catch (err) {
			if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
		}
		const { users, problems } = parseUsers(text);
		this.#users = users;
		for (const [token, session] of this.#sessions) {
			if (!users.has(session.user)) this.#sessions.delete(token);
		}
		this.#log(
			`users: ${users.size} from ${this.#file}` +
				(problems.length ? ` — could not read line ${problems.join(', ')}` : '')
		);
	}

	/** Read the file again when it changes, or on SIGHUP. */
	watch() {
		const reload = () => this.load().catch((err) => this.#log(`users: ${err.message}`));
		// Polling, not fs.watch: it also sees a file that an editor or
		// `docker cp` replaces with a new one.
		watchFile(this.#file, { interval: 2000 }, reload);
		process.on('SIGHUP', reload);
	}

	/**
	 * A new session token for `name` if `password` is theirs, else `null`.
	 * `address` is where the attempt comes from: after too many failures
	 * from there, it throws an error with `status` 429.
	 */
	async login(name, password, address) {
		const now = Date.now();
		const failures = this.#failures.get(address);
		if (failures && now - failures.since > FAILURE_WINDOW_MS) this.#failures.delete(address);
		if ((this.#failures.get(address)?.count ?? 0) >= MAX_FAILURES) {
			throw Object.assign(new Error('Too many failed logins. Try again later.'), { status: 429 });
		}
		const stored = this.#users.get(name);
		const ok = await verifyPassword(password, stored ?? (await DUMMY));
		if (!stored || !ok) {
			const entry = this.#failures.get(address) ?? { count: 0, since: now };
			entry.count++;
			this.#failures.set(address, entry);
			return null;
		}
		this.#failures.delete(address);
		const token = randomBytes(32).toString('base64url');
		this.#sessions.set(token, { user: name, expires: now + SESSION_DAYS * 24 * 3600 * 1000 });
		return token;
	}

	/** The user a session token belongs to, or `null`. */
	userOf(token) {
		if (!token) return null;
		const session = this.#sessions.get(token);
		if (!session) return null;
		if (session.expires < Date.now()) {
			this.#sessions.delete(token);
			return null;
		}
		return session.user;
	}

	logout(token) {
		this.#sessions.delete(token);
	}
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;
