// @vitest-environment node
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AcmeClient, Certificates, createCsr, needsRenewal } from './acme.mjs';
import { CERT } from './test-certificate.mjs';

describe('needsRenewal', () => {
	const domains = ['map.example.org'];
	it('renews when a third of the lifetime is left', () => {
		expect(needsRenewal(CERT, domains, Date.parse('2026-02-01'))).toBe(false);
		expect(needsRenewal(CERT, domains, Date.parse('2026-03-01'))).toBe(false);
		expect(needsRenewal(CERT, domains, Date.parse('2026-03-03'))).toBe(true);
		expect(needsRenewal(CERT, domains, Date.parse('2026-05-01'))).toBe(true);
	});

	it('renews when a domain is not covered, or there is no certificate', () => {
		const now = Date.parse('2026-02-01');
		expect(needsRenewal(CERT, ['WWW.example.org', 'map.example.org'], now)).toBe(false);
		expect(needsRenewal(CERT, ['other.example.org'], now)).toBe(true);
		expect(needsRenewal('not a certificate', domains, now)).toBe(true);
	});
});

describe('createCsr', () => {
	it('is DER, signed by the key, and names the domains', () => {
		const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
		const csr = createCsr(key, ['map.example.org', 'www.example.org']);
		expect(csr[0]).toBe(0x30);
		expect(csr.toString('latin1')).toContain('map.example.org');
		expect(csr.toString('latin1')).toContain('www.example.org');
		const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
		expect(csr.includes(spki)).toBe(true);
	});
});

/**
 * An ACME server in a `fetch`: checks every signature and nonce, makes the
 * client answer one HTTP challenge, and issues CERT. The first order gets a
 * stale-nonce error, as a real server may send.
 */
function fakeAcme() {
	const base = 'https://acme.test';
	const nonces = new Set();
	let nonceCount = 0;
	const nonce = () => {
		const n = `n${++nonceCount}`;
		nonces.add(n);
		return n;
	};
	/** @type {Record<string, any>} */
	const accounts = {};
	const state = {
		authz: 'pending',
		order: 'pending',
		badNonceSent: false,
		csr: null,
		answered: null
	};
	const token = 'tok_123';
	/** @type {((token: string) => string | undefined) | null} */
	let lookUp = null;

	const json = (status, body, headers = {}) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json', 'Replay-Nonce': nonce(), ...headers }
		});

	/** @type {typeof fetch} */
	const fakeFetch = async (input, init = {}) => {
		const url = String(input);
		const path = url.slice(base.length);
		if (path === '/dir') {
			return json(200, {
				newNonce: `${base}/nonce`,
				newAccount: `${base}/acct`,
				newOrder: `${base}/order`
			});
		}
		if (path === '/nonce') return new Response(null, { headers: { 'Replay-Nonce': nonce() } });

		const jws = JSON.parse(String(init.body));
		const header = JSON.parse(Buffer.from(jws.protected, 'base64url').toString());
		expect(header.url).toBe(url);
		expect(nonces.delete(header.nonce)).toBe(true);
		const jwk = header.jwk ?? accounts[header.kid];
		expect(jwk).toBeTruthy();
		expect(
			verify(
				'sha256',
				Buffer.from(`${jws.protected}.${jws.payload}`),
				{ key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
				Buffer.from(jws.signature, 'base64url')
			)
		).toBe(true);
		const payload = jws.payload
			? JSON.parse(Buffer.from(jws.payload, 'base64url').toString())
			: undefined;

		switch (path) {
			case '/acct':
				expect(payload.termsOfServiceAgreed).toBe(true);
				accounts[`${base}/acct/1`] = jwk;
				return json(201, { status: 'valid' }, { Location: `${base}/acct/1` });
			case '/order':
				if (!state.badNonceSent) {
					state.badNonceSent = true;
					return json(400, { type: 'urn:ietf:params:acme:error:badNonce', detail: 'stale' });
				}
				expect(header.kid).toBe(`${base}/acct/1`);
				expect(payload.identifiers).toEqual([{ type: 'dns', value: 'map.example.org' }]);
				return json(
					201,
					{ status: 'pending', authorizations: [`${base}/authz/1`], finalize: `${base}/finalize` },
					{ Location: `${base}/order/1` }
				);
			case '/authz/1':
				return json(200, {
					status: state.authz,
					identifier: { type: 'dns', value: 'map.example.org' },
					challenges: [
						{ type: 'dns-01', url: `${base}/chall/dns`, token },
						{ type: 'http-01', url: `${base}/chall/1`, token }
					]
				});
			case '/chall/1': {
				// What port 80 would answer, against what it should.
				const thumbprint = createHash('sha256')
					.update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
					.digest('base64url');
				state.answered = lookUp?.(token) ?? null;
				expect(state.answered).toBe(`${token}.${thumbprint}`);
				state.authz = 'valid';
				state.order = 'ready';
				return json(200, { type: 'http-01', status: 'processing' });
			}
			case '/finalize':
				state.csr = payload.csr;
				state.order = 'valid';
				return json(200, { status: 'processing' });
			case '/order/1':
				return json(200, {
					status: state.order,
					...(state.order === 'valid' && { certificate: `${base}/cert` })
				});
			case '/cert':
				return new Response(CERT, {
					headers: { 'Content-Type': 'application/pem-certificate-chain', 'Replay-Nonce': nonce() }
				});
		}
		return json(404, { detail: `no ${path}` });
	};
	return {
		fetch: fakeFetch,
		directoryUrl: `${base}/dir`,
		state,
		token,
		/** How the fake looks up the answer port 80 gives. */
		answersWith: (/** @type {(token: string) => string | undefined} */ f) => (lookUp = f)
	};
}

describe('AcmeClient', () => {
	it('gets a certificate: account, order, HTTP challenge, request', async () => {
		const acme = fakeAcme();
		const client = new AcmeClient({
			directoryUrl: acme.directoryUrl,
			accountKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
			fetch: acme.fetch,
			delay: 1
		});
		const answers = new Map();
		acme.answersWith((token) => answers.get(token));
		const certKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
		const pem = await client.certificate(['map.example.org'], certKey, (token, answer) => {
			answers.set(token, answer);
			return () => answers.delete(token);
		});
		expect(pem).toBe(CERT);
		expect(acme.state.answered).toBeTruthy();
		expect(answers.size).toBe(0);
		// The request is for the certificate's key, not the account's.
		const spki = createPublicKey(certKey).export({ type: 'spki', format: 'der' });
		expect(Buffer.from(acme.state.csr, 'base64url').includes(spki)).toBe(true);
	});
});

describe('Certificates', () => {
	let dir;
	beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'tls-'))));
	afterEach(() => rm(dir, { recursive: true, force: true }));

	it('keeps the account, the key and the certificate on disk', async () => {
		const acme = fakeAcme();
		const certs = new Certificates({
			dir,
			domains: ['map.example.org'],
			directoryUrl: acme.directoryUrl,
			fetch: acme.fetch
		});
		acme.answersWith((token) => certs.challenges.get(token));
		expect(await certs.load()).toBeNull();
		expect(certs.needsRenewal(null)).toBe(true);

		const pair = await certs.renew();
		expect(pair.cert).toBe(CERT);
		expect(pair.key).toContain('PRIVATE KEY');
		expect(await certs.load()).toEqual(pair);
		expect(certs.challenges.size).toBe(0);
		for (const name of ['account.key', 'key.pem', 'cert.pem']) {
			expect((await stat(join(dir, name))).mode & 0o777).toBe(0o600);
		}
		const account = await readFile(join(dir, 'account.key'), 'utf8');

		// A second renewal uses the same account.
		await certs.renew();
		expect(await readFile(join(dir, 'account.key'), 'utf8')).toBe(account);
		expect(certs.needsRenewal(pair, Date.parse('2026-02-01'))).toBe(false);
	});
});
