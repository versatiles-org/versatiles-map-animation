/**
 * Base64-URL encoding helpers (URL-safe alphabet, no padding).
 * Used by the URL hash to ferry the bit-packed binary payload.
 */

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
