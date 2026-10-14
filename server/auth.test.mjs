// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Accounts, formatUser, hashPassword, parseUsers, verifyPassword } from './auth.mjs';

describe('passwords', () => {
	it('are stored salted and checked against what is stored', async () => {
		const a = await hashPassword('correct horse');
		const b = await hashPassword('correct horse');
		expect(a).toMatch(/^scrypt:[\w-]+:[\w-]+$/);
		expect(a).not.toBe(b);
		expect(await verifyPassword('correct horse', a)).toBe(true);
		expect(await verifyPassword('correct hors', a)).toBe(false);
		expect(await verifyPassword('x', 'plain:text')).toBe(false);
		expect(await verifyPassword('x', 'scrypt::')).toBe(false);
	});
});

describe('parseUsers', () => {
	it('reads one user per line and skips comments, blank lines and broken ones', () => {
		const { users, problems } = parseUsers(
			[
				'# users',
				'',
				'alice:scrypt:a:b',
				'bob:plain',
				'no colon',
				'bad name!:scrypt:a:b',
				'carol:scrypt:c:d'
			].join('\n')
		);
		expect([...users.keys()]).toEqual(['alice', 'carol']);
		expect(users.get('alice')).toBe('scrypt:a:b');
		expect(problems).toEqual([4, 5, 6]);
	});
});

describe('Accounts', () => {
	let dir;
	let file;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'accounts-'));
		file = join(dir, 'users.txt');
		await writeFile(
			file,
			[
				formatUser('alice', await hashPassword('alice-secret')),
				formatUser('bob', await hashPassword('bob-secret'))
			].join('\n')
		);
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	it('logs in with the right password only, and knows whose session it is', async () => {
		const accounts = new Accounts(file);
		await accounts.load();
		expect(accounts.size).toBe(2);
		expect(await accounts.login('alice', 'wrong', '1.2.3.4')).toBeNull();
		expect(await accounts.login('nobody', 'alice-secret', '1.2.3.4')).toBeNull();
		const token = await accounts.login('alice', 'alice-secret', '1.2.3.4');
		expect(token).toMatch(/^[\w-]{40,}$/);
		expect(accounts.userOf(token)).toBe('alice');
		expect(accounts.userOf('made-up')).toBeNull();
		expect(accounts.userOf(undefined)).toBeNull();
		accounts.logout(token);
		expect(accounts.userOf(token)).toBeNull();
	});

	it('logs out a user who is taken out of the file, on reload', async () => {
		const accounts = new Accounts(file);
		await accounts.load();
		const alice = await accounts.login('alice', 'alice-secret', 'x');
		const bob = await accounts.login('bob', 'bob-secret', 'x');
		await writeFile(file, formatUser('bob', await hashPassword('bob-secret')));
		await accounts.load();
		expect(accounts.userOf(alice)).toBeNull();
		expect(accounts.userOf(bob)).toBe('bob');
	});

	it('has no users without a file', async () => {
		const accounts = new Accounts(join(dir, 'missing.txt'));
		await accounts.load();
		expect(accounts.size).toBe(0);
		expect(await accounts.login('alice', 'alice-secret', 'x')).toBeNull();
	});

	it('makes an address wait after too many failures, but not others', async () => {
		const accounts = new Accounts(file);
		await accounts.load();
		for (let i = 0; i < 10; i++) await accounts.login('alice', 'wrong', '6.6.6.6');
		await expect(accounts.login('alice', 'alice-secret', '6.6.6.6')).rejects.toMatchObject({
			status: 429
		});
		expect(await accounts.login('alice', 'alice-secret', '7.7.7.7')).not.toBeNull();
	});
});
