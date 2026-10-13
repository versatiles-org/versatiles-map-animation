import { validateAnimation } from '../json_io';
import type { Animation } from '../types';

/**
 * The animations of the editor's "Examples" menu: every `.json` file in this
 * folder. To add one, build it in the editor, save it with File → Export
 * JSON and put the file here. Two extra keys at the top of the file say how
 * the menu presents it:
 *
 *   "title":       the menu entry (without it, the file name)
 *   "description": one sentence, shown as the entry's tooltip
 *
 * The files go through the same validation as an imported one, so an
 * example cannot hold anything the editor would not load.
 */
export interface Example {
	/** File name without `.json`. */
	id: string;
	title: string;
	description?: string;
	animation: Animation;
}

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export const EXAMPLES: Example[] = Object.entries(files)
	.map(([path, content]): Example => {
		const id = path.replace(/^\.\//, '').replace(/\.json$/, '');
		const { title, description } = content as { title?: unknown; description?: unknown };
		return {
			id,
			title: typeof title === 'string' && title ? title : id,
			...(typeof description === 'string' && description && { description }),
			animation: validateAnimation(content)
		};
	})
	.sort((a, b) => a.title.localeCompare(b.title));
