// The page of a user's renders: the form for a new one, and the list of
// them, newest first, kept up to date by asking the server every few seconds.

const FORMAT_LABELS = { mp4: 'MP4', prores: 'ProRes', ffv1: 'FFV1', animation: 'Animation' };
const PHASES = {
	preparing: 'Starting',
	warming: 'Loading map tiles',
	rendering: 'Rendering frames',
	encoding: 'Encoding',
	preview: 'Making preview'
};
/** Share of the whole render each phase stands for, roughly, for one progress bar. */
const PHASE_SPANS = {
	preparing: [0, 0.02],
	warming: [0.02, 0.1],
	rendering: [0.1, 0.96],
	encoding: [0.96, 0.99],
	preview: [0.99, 1]
};

const list = document.getElementById('jobs');
const empty = document.getElementById('empty');
const form = document.getElementById('new');
const formMessage = document.getElementById('formMessage');

/** The card of each job shown, and what it showed last, by job id. */
const cards = new Map();

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === false) continue;
		if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else node.setAttribute(key, value === true ? '' : value);
	}
	node.append(...children.filter((c) => c !== null && c !== undefined));
	return node;
}

function fmtDuration(seconds) {
	if (!Number.isFinite(seconds)) return '';
	const s = Math.max(0, Math.round(seconds));
	const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
	if (s < 60) return `${s} s`;
	if (s < 3600) return `${Math.floor(s / 60)}:${pad(s % 60)} min`;
	return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)} h`;
}
function fmtSize(bytes) {
	if (!Number.isFinite(bytes)) return '';
	return bytes < 1e6 ? `${(bytes / 1e3).toFixed(0)} kB` : `${(bytes / 1e6).toFixed(1)} MB`;
}
function fmtTime(iso) {
	return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** How far along a render is, 0…1. */
function fraction(progress) {
	const [from, to] = PHASE_SPANS[progress?.phase] ?? [0, 0];
	const within = progress?.total ? progress.done / progress.total : 0;
	return from + (to - from) * within;
}

async function api(path, options = {}) {
	const res = await fetch(path, { credentials: 'same-origin', ...options });
	if (res.status === 401) {
		location.href = `/renders/login?next=${encodeURIComponent(location.pathname)}`;
		throw new Error('Not logged in');
	}
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
	return body;
}

function stateOf(job) {
	switch (job.status) {
		case 'queued':
			return el(
				'p',
				{ class: 'state' },
				job.ahead > 0 ? `Waiting — ${job.ahead} before it` : 'Waiting — next in line'
			);
		case 'rendering': {
			const p = job.progress ?? {};
			const share = Math.round(fraction(p) * 100);
			const detail = [
				PHASES[p.phase] ?? 'Rendering',
				p.total ? `${p.done} / ${p.total}` : null,
				p.eta ? `about ${fmtDuration(p.eta)} left` : null
			]
				.filter(Boolean)
				.join(' · ');
			return el(
				'div',
				{ class: 'state' },
				el('progress', { max: '100', value: String(share), 'aria-label': 'Progress' }),
				el('span', {}, `${share} % — ${detail}`)
			);
		}
		case 'finished':
			return el(
				'p',
				{ class: 'state' },
				['Finished', fmtDuration(job.duration), fmtSize(job.size)].filter(Boolean).join(' · ')
			);
		case 'failed':
			return el(
				'details',
				{ class: 'state error' },
				el('summary', {}, 'Failed — show why'),
				el('pre', {}, job.error ?? '')
			);
		default:
			return el('p', { class: 'state' }, 'Cancelled');
	}
}

function mediaOf(job) {
	if (job.status !== 'finished') {
		return el('div', { class: 'media placeholder' }, job.status === 'rendering' ? '…' : '');
	}
	const base = `/api/jobs/${job.id}`;
	const video = el('video', {
		src: `${base}/preview`,
		poster: `${base}/poster`,
		muted: true,
		loop: true,
		playsinline: true,
		preload: 'none',
		'aria-label': 'Preview'
	});
	video.muted = true;
	const media = el(
		'a',
		{
			class: 'media',
			href: `${base}/video`,
			target: '_blank',
			title: 'Open the video',
			onmouseenter: () => video.play().catch(() => {}),
			onmouseleave: () => {
				video.pause();
				video.currentTime = 0;
			},
			onfocus: () => video.play().catch(() => {}),
			onblur: () => video.pause()
		},
		video
	);
	return media;
}

function buttonsOf(job) {
	const remove = async (question) => {
		if (question && !confirm(question)) return;
		try {
			await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
		} catch (err) {
			alert(err.message);
		}
		refresh();
	};
	const buttons = [];
	if (job.status === 'finished') {
		buttons.push(
			el('a', { class: 'button primary', href: `/api/jobs/${job.id}/video?download` }, 'Download')
		);
	}
	if (job.status === 'queued' || job.status === 'rendering') {
		buttons.push(
			el(
				'button',
				{
					type: 'button',
					onclick: () => remove(job.status === 'rendering' && 'Stop this render?')
				},
				'Cancel'
			)
		);
	} else {
		buttons.push(
			el(
				'button',
				{
					type: 'button',
					onclick: () => remove(job.status === 'finished' && 'Delete this video?')
				},
				'Delete'
			)
		);
	}
	return el('div', { class: 'buttons' }, ...buttons);
}

function cardOf(job) {
	const s = job.settings;
	const meta = [
		fmtTime(job.createdAt),
		job.height ? `${job.width} × ${job.height}` : `${s.width} px wide`,
		`${s.fps} fps`,
		FORMAT_LABELS[s.format] ?? s.format,
		s.format === 'mp4' ? s.quality : null,
		s.motionBlur > 1 ? `motion blur ${s.motionBlur}×` : null
	]
		.filter(Boolean)
		.join(' · ');
	return el(
		'li',
		{ class: `job ${job.status}`, 'data-id': job.id },
		mediaOf(job),
		el(
			'div',
			{ class: 'info' },
			el('h3', {}, job.title || 'Untitled'),
			el('p', { class: 'meta' }, meta),
			stateOf(job)
		),
		buttonsOf(job)
	);
}

function show(jobs) {
	const seen = new Set();
	jobs.forEach((job, i) => {
		seen.add(job.id);
		// Rebuilt only when it changed, so a preview that plays keeps playing.
		const signature = JSON.stringify([job.status, job.progress, job.ahead, job.size]);
		let entry = cards.get(job.id);
		if (!entry || entry.signature !== signature) {
			const card = cardOf(job);
			if (entry) entry.card.replaceWith(card);
			entry = { card, signature };
			cards.set(job.id, entry);
		}
		if (list.children[i] !== entry.card) list.insertBefore(entry.card, list.children[i] ?? null);
	});
	for (const [id, entry] of cards) {
		if (!seen.has(id)) {
			entry.card.remove();
			cards.delete(id);
		}
	}
	empty.hidden = jobs.length > 0;
}

let timer;
async function refresh() {
	clearTimeout(timer);
	let busy = false;
	try {
		const { jobs } = await api('/api/jobs');
		show(jobs);
		busy = jobs.some((job) => job.status === 'queued' || job.status === 'rendering');
	} catch {
		// Shown again on the next try.
	}
	timer = setTimeout(refresh, busy ? 2000 : 10000);
}

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	const data = new FormData(form);
	formMessage.textContent = '';
	try {
		await api('/api/jobs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				link: data.get('link'),
				title: data.get('title'),
				settings: {
					width: Number(data.get('width')),
					fps: Number(data.get('fps')),
					format: data.get('format'),
					quality: data.get('quality'),
					motionBlur: Number(data.get('motionBlur'))
				}
			})
		});
		// Emptied for the next one — unless that is being typed in already.
		for (const name of ['link', 'title']) {
			if (form.elements[name].value === data.get(name)) form.elements[name].value = '';
		}
		formMessage.textContent = 'Added.';
		refresh();
	} catch (err) {
		formMessage.textContent = err.message;
	}
});

// Quality applies to MP4 only.
const quality = form.elements.quality;
const syncQuality = () => (quality.disabled = form.elements.format.value !== 'mp4');
form.elements.format.addEventListener('change', syncQuality);
syncQuality();

api('/api/me')
	.then(({ user }) => (document.getElementById('user').textContent = user))
	.catch(() => {});
refresh();
