/**
 * Base64-URL helpers (URL-safe, no padding) and codec wrappers that encode
 * straight to / from a base64-url string.
 */

import { pack, unpack, type Codec } from './core';

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlToBytes(s: string): Uint8Array {
	const pad = (4 - (s.length % 4)) % 4;
	const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function packBase64Url<T>(codec: Codec<T>, value: T): string {
	return bytesToBase64Url(pack(codec, value));
}

export function unpackBase64Url<T>(codec: Codec<T>, s: string): T {
	return unpack(codec, base64UrlToBytes(s));
}
