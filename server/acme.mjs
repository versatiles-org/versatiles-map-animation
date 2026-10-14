/**
 * Certificates from Let's Encrypt (or any ACME server, RFC 8555), for when
 * the server has a domain name: an account, an order for the domain, the
 * HTTP-01 challenge answered on port 80, and the certificate — renewed when
 * a third of its lifetime is left. Only Node.js' own crypto: the account and
 * certificate keys are ECDSA P-256, and the certificate request is written
 * out in DER by hand below.
 */

import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
	X509Certificate
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETS_ENCRYPT_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';

/** Where the ACME server asks for the answer to a challenge. */
export const CHALLENGE_PATH = '/.well-known/acme-challenge/';

const b64url = (/** @type {Buffer | string} */ data) => Buffer.from(data).toString('base64url');
const newKey = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const keyPem = (/** @type {import('node:crypto').KeyObject} */ key) =>
	/** @type {string} */ (key.export({ type: 'pkcs8', format: 'pem' }));

// --- A certificate request, in DER -----------------------------------------

/** One DER element: tag, length, content. */
function der(/** @type {number} */ tag, /** @type {Buffer[]} */ ...content) {
	const body = Buffer.concat(content);
	const n = body.length;
	const length =
		n < 0x80
			? Buffer.from([n])
			: n < 0x100
				? Buffer.from([0x81, n])
				: Buffer.from([0x82, n >> 8, n & 0xff]);
	return Buffer.concat([Buffer.from([tag]), length, body]);
}
const seq = (/** @type {Buffer[]} */ ...c) => der(0x30, ...c);
const set = (/** @type {Buffer[]} */ ...c) => der(0x31, ...c);
function oid(/** @type {string} */ dotted) {
	const [a, b, ...rest] = dotted.split('.').map(Number);
	const bytes = [40 * a + b];
	for (const n of rest) {
		const parts = [n & 0x7f];
		for (let v = n >> 7; v > 0; v >>= 7) parts.unshift((v & 0x7f) | 0x80);
		bytes.push(...parts);
	}
	return der(0x06, Buffer.from(bytes));
}

/**
 * A PKCS #10 certificate request for `domains` (the first is the common
 * name, all are subject alternative names), signed with `key`, as DER.
 *
 * @param {import('node:crypto').KeyObject} key  an EC P-256 private key
 * @param {string[]} domains
 */
export function createCsr(key, domains) {
	const info = seq(
		der(0x02, Buffer.from([0])), // version 1
		seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(domains[0]))))), // CN
		/** @type {Buffer} */ (createPublicKey(key).export({ type: 'spki', format: 'der' })),
		der(
			0xa0, // attributes
			seq(
				oid('1.2.840.113549.1.9.14'), // extensionRequest
				set(
					seq(
						seq(
							oid('2.5.29.17'), // subjectAltName
							der(0x04, seq(...domains.map((d) => der(0x82, Buffer.from(d)))))
						)
					)
				)
			)
		)
	);
	return seq(
		info,
		seq(oid('1.2.840.10045.4.3.2')), // ecdsa-with-SHA256
		der(0x03, Buffer.from([0]), sign('sha256', info, key))
	);
}

// --- The ACME protocol -----------------------------------------------------

/**
 * Just enough of ACME to get a certificate: every request is a signed POST
 * (JWS, ES256), each carrying a fresh nonce from the server.
 */
export class AcmeClient {
	#directoryUrl;
	#key;
	#fetch;
	#delay;
	/** @type {Record<string, string> | null} */
	#directory = null;
	/** @type {string | null} */
	#nonce = null;
	/** @type {string | null} */
	#kid = null;

	/**
	 * @param {{ directoryUrl: string, accountKey: import('node:crypto').KeyObject, fetch?: typeof fetch, delay?: number }} options
	 */
	constructor({ directoryUrl, accountKey, fetch: f = fetch, delay = 2000 }) {
		this.#directoryUrl = directoryUrl;
		this.#key = accountKey;
		this.#fetch = f;
		this.#delay = delay;
	}

	/** The account key as JWK, its members in the order RFC 7638 wants for the thumbprint. */
	get #jwk() {
		const { crv, kty, x, y } = createPublicKey(this.#key).export({ format: 'jwk' });
		return { crv, kty, x, y };
	}

	/** What a challenge is answered with: its token and the account key's thumbprint. */
	keyAuthorization(/** @type {string} */ token) {
		const thumbprint = createHash('sha256').update(JSON.stringify(this.#jwk)).digest();
		return `${token}.${b64url(thumbprint)}`;
	}

	async #dir() {
		if (!this.#directory) {
			const res = await this.#fetch(this.#directoryUrl);
			if (!res.ok) throw new Error(`ACME directory: HTTP ${res.status}`);
			this.#directory = /** @type {Record<string, string>} */ (await res.json());
		}
		return this.#directory;
	}

	async #newNonce() {
		const res = await this.#fetch((await this.#dir()).newNonce, { method: 'HEAD' });
		const nonce = res.headers.get('replay-nonce');
		if (!nonce) throw new Error('ACME: no nonce');
		return nonce;
	}

	/**
	 * A signed POST; `payload` undefined is a POST-as-GET. Resolves with the
	 * response, its body (JSON or text) and its Location.
	 *
	 * @returns {Promise<{ res: Response, body: any, location: string | null }>}
	 */
	async post(/** @type {string} */ url, /** @type {unknown} */ payload, retry = true) {
		const nonce = this.#nonce ?? (await this.#newNonce());
		this.#nonce = null;
		const header = {
			alg: 'ES256',
			nonce,
			url,
			...(this.#kid ? { kid: this.#kid } : { jwk: this.#jwk })
		};
		const protectedPart = b64url(JSON.stringify(header));
		const payloadPart = payload === undefined ? '' : b64url(JSON.stringify(payload));
		const signature = sign('sha256', Buffer.from(`${protectedPart}.${payloadPart}`), {
			key: this.#key,
			dsaEncoding: 'ieee-p1363'
		});
		const res = await this.#fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/jose+json' },
			body: JSON.stringify({
				protected: protectedPart,
				payload: payloadPart,
				signature: b64url(signature)
			})
		});
		this.#nonce = res.headers.get('replay-nonce');
		const type = res.headers.get('content-type') ?? '';
		const body = type.includes('json') ? await res.json() : await res.text();
		if (!res.ok) {
			// A nonce can go stale; the server says so, and a new one will do.
			if (retry && body?.type === 'urn:ietf:params:acme:error:badNonce') {
				return this.post(url, payload, false);
			}
			throw new Error(`ACME ${new URL(url).pathname}: ${body?.detail ?? `HTTP ${res.status}`}`);
		}
		return { res, body, location: res.headers.get('location') };
	}

	/** Register the account, or find it again: the server knows it by its key. */
	async account(/** @type {string | undefined} */ email) {
		if (this.#kid) return;
		const { location } = await this.post((await this.#dir()).newAccount, {
			termsOfServiceAgreed: true,
			...(email && { contact: [`mailto:${email}`] })
		});
		if (!location) throw new Error('ACME: the account has no URL');
		this.#kid = location;
	}

	/** Ask `url` (POST-as-GET) until its status is `want`; an `invalid` one is an error. */
	async #poll(/** @type {string} */ url, /** @type {string[]} */ want, tries = 60) {
		for (let i = 0; i < tries; i++) {
			const { body, res } = await this.post(url, undefined);
			if (want.includes(body.status)) return body;
			if (body.status === 'invalid') {
				const problem =
					body.error ?? body.challenges?.find((/** @type {any} */ c) => c.error)?.error;
				throw new Error(`ACME: ${problem?.detail ?? `${url} is invalid`}`);
			}
			const after = Number(res.headers.get('retry-after'));
			const wait = after > 0 ? Math.min(after * 1000, 30_000) : this.#delay;
			await new Promise((r) => setTimeout(r, wait));
		}
		throw new Error(`ACME: ${url} took too long`);
	}

	/**
	 * A certificate for `domains`: the PEM chain. `respond(token, answer)`
	 * makes port 80 answer the challenge for its token until the returned
	 * function is called.
	 *
	 * @param {string[]} domains
	 * @param {import('node:crypto').KeyObject} certKey
	 * @param {(token: string, answer: string) => () => void} respond
	 * @param {string} [email]
	 */
	async certificate(domains, certKey, respond, email) {
		await this.account(email);
		const order = await this.post((await this.#dir()).newOrder, {
			identifiers: domains.map((value) => ({ type: 'dns', value }))
		});
		const orderUrl = order.location;
		if (!orderUrl) throw new Error('ACME: the order has no URL');

		for (const authzUrl of order.body.authorizations) {
			const { body: authz } = await this.post(authzUrl, undefined);
			if (authz.status === 'valid') continue;
			const challenge = authz.challenges.find((/** @type {any} */ c) => c.type === 'http-01');
			if (!challenge) throw new Error(`ACME: no HTTP challenge for ${authz.identifier.value}`);
			const done = respond(challenge.token, this.keyAuthorization(challenge.token));
			try {
				await this.post(challenge.url, {});
				await this.#poll(authzUrl, ['valid']);
			} finally {
				done();
			}
		}

		await this.#poll(orderUrl, ['ready', 'valid']);
		await this.post(order.body.finalize, { csr: b64url(createCsr(certKey, domains)) });
		const issued = await this.#poll(orderUrl, ['valid']);
		const { body: pem } = await this.post(issued.certificate, undefined);
		if (typeof pem !== 'string' || !pem.includes('BEGIN CERTIFICATE')) {
			throw new Error('ACME: the certificate is not PEM');
		}
		return pem;
	}
}

// --- Keeping a certificate -------------------------------------------------

/**
 * Whether a certificate has to be (re)newed: when it does not cover all of
 * `domains`, or has less than a third of its lifetime left — 30 days of 90,
 * and the right share of the shorter ones Let's Encrypt is moving to.
 */
export function needsRenewal(
	/** @type {string} */ pem,
	/** @type {string[]} */ domains,
	now = Date.now()
) {
	let cert;
	try {
		cert = new X509Certificate(pem);
	} catch {
		return true;
	}
	const names = (cert.subjectAltName ?? '')
		.split(',')
		.map((s) => s.trim().replace(/^DNS:/, '').toLowerCase());
	if (!domains.every((d) => names.includes(d.toLowerCase()))) return true;
	const from = Date.parse(cert.validFrom);
	const to = Date.parse(cert.validTo);
	return now > to - (to - from) / 3;
}

/**
 * The certificate of this server: kept in `dir` (`account.key`, `key.pem`,
 * `cert.pem`), renewed with an `AcmeClient`, and the challenges it is
 * answering meanwhile, for the HTTP server on port 80.
 */
export class Certificates {
	/** token → answer */
	challenges = new Map();
	#dir;
	#domains;
	#email;
	#directoryUrl;
	#fetch;
	/** @type {AcmeClient | null} */
	#client = null;

	/**
	 * @param {{ dir: string, domains: string[], email?: string, directoryUrl?: string, fetch?: typeof fetch }} options
	 */
	constructor({ dir, domains, email, directoryUrl = LETS_ENCRYPT, fetch: f }) {
		this.#dir = dir;
		this.#domains = domains;
		this.#email = email;
		this.#directoryUrl = directoryUrl;
		this.#fetch = f;
	}

	/** The certificate and key on disk, or `null`. */
	async load() {
		try {
			return {
				key: await readFile(join(this.#dir, 'key.pem'), 'utf8'),
				cert: await readFile(join(this.#dir, 'cert.pem'), 'utf8')
			};
		} catch {
			return null;
		}
	}

	/** Whether `pair` (from `load`) has to be renewed. */
	needsRenewal(/** @type {{ cert: string } | null} */ pair, now = Date.now()) {
		return !pair || needsRenewal(pair.cert, this.#domains, now);
	}

	/** Get a new certificate, keep it on disk, and return it. */
	async renew() {
		await mkdir(this.#dir, { recursive: true, mode: 0o700 });
		this.#client ??= new AcmeClient({
			directoryUrl: this.#directoryUrl,
			accountKey: await this.#accountKey(),
			...(this.#fetch && { fetch: this.#fetch })
		});
		const certKey = newKey();
		const cert = await this.#client.certificate(
			this.#domains,
			certKey,
			(token, answer) => {
				this.challenges.set(token, answer);
				return () => this.challenges.delete(token);
			},
			this.#email
		);
		const key = keyPem(certKey);
		await this.#write('key.pem', key);
		await this.#write('cert.pem', cert);
		return { key, cert };
	}

	async #accountKey() {
		const file = join(this.#dir, 'account.key');
		try {
			return createPrivateKey(await readFile(file, 'utf8'));
		} catch {
			const key = newKey();
			await this.#write('account.key', keyPem(key));
			return key;
		}
	}

	async #write(/** @type {string} */ name, /** @type {string} */ text) {
		const file = join(this.#dir, name);
		await writeFile(`${file}.tmp`, text, { mode: 0o600 });
		await rename(`${file}.tmp`, file);
	}
}
