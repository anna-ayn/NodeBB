import validator from 'validator';
import winston from 'winston';

import plugins from '../plugins';
import db from '../database';
import pubsub from '../pubsub';

import promisify from '../promisify';
import navigationData from '../../install/data/navigation.json';

// Interface for the structure of navigation items
interface NavigationItem {
	id?: string;
	route?: string;
	title?: string;
	enable?: boolean;
	iconClass?: string;
	textClass?: string;
	text?: string;
	groups?: string | string[];
	order?: string;
	class?: string;
	core?: boolean;
	[key: string]: string | string[] | boolean | undefined;
}

// Interface for the Admin
interface Admin {
	save: (data: NavigationItem[]) => Promise<void>;
	getAdmin: () => Promise<{ enabled: NavigationItem[], available: NavigationItem[] }>;
	getAvailable: () => Promise<NavigationItem[]>;
	escapeFields: (navItems: NavigationItem[]) => void;
	unescapeFields: (navItems: NavigationItem[]) => void;
	get: () => Promise<NavigationItem[]>;
}

let cache: NavigationItem[] | null = null;

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
pubsub.on('admin:navigation:save', () => {
	cache = null;
});

const fieldsToEscape: (keyof NavigationItem)[] = ['iconClass', 'class', 'route', 'id', 'text', 'textClass', 'title'];

function toggleEscape(navItems: NavigationItem[], flag: boolean): void {
	navItems.forEach((item) => {
		if (item) {
			fieldsToEscape.forEach((field) => {
				if (item.hasOwnProperty(field)) {
					item[field] = validator[flag ? 'escape' : 'unescape'](String(item[field]));
				}
			});
		}
	});
}

const admin: Admin = {
	save: async function (data: NavigationItem[]): Promise<void> {
		const order: string[] = Object.keys(data);
		const bulkSet: [string, NavigationItem][] = [];
		data.forEach((item, index) => {
			item.order = order[index];
			if (item.hasOwnProperty('groups')) {
				item.groups = JSON.stringify(item.groups);
			}
			bulkSet.push([`navigation:enabled:${item.order}`, item]);
		});

		cache = null;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		pubsub.publish('admin:navigation:save');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		const ids = await db.getSortedSetRange('navigation:enabled', 0, -1) as string[];
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		await db.deleteAll(ids.map(id => `navigation:enabled:${id}`));
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		await db.setObjectBulk(bulkSet);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		await db.delete('navigation:enabled');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		await db.sortedSetAdd('navigation:enabled', order, order);
	},
	get: async function (): Promise<NavigationItem[]> {
		if (cache) {
			return cache.map(item => ({ ...item }));
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		const ids = await db.getSortedSetRange('navigation:enabled', 0, -1) as string[];
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		const data = await db.getObjects(ids.map(id => `navigation:enabled:${id}`)) as NavigationItem[];
		cache = data.filter(Boolean).map((item: NavigationItem) => {
			if (item.hasOwnProperty('groups')) {
				try {
					item.groups = JSON.parse(item.groups as string) as string[];
				} catch (err) {
					if (err instanceof Error) {
						winston.error(err.stack);
					} else {
						winston.error('Unknown error', err);
					}
					item.groups = [];
				}
			}
			item.groups = item.groups || [];
			if (item.groups && !Array.isArray(item.groups)) {
				item.groups = [item.groups];
			}
			return item;
		});
		admin.escapeFields(cache);

		return cache.map(item => ({ ...item }));
	},
	getAvailable: async function (): Promise<NavigationItem[]> {
		const core: NavigationItem[] = navigationData.map((item: NavigationItem) => {
			item.core = true;
			item.id = item.id || '';
			return item;
		});

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		const navItems = await plugins.hooks.fire('filter:navigation.available', core) as NavigationItem[];
		navItems.forEach((item) => {
			if (item && !item.hasOwnProperty('enabled')) {
				item.enabled = true;
			}
		});
		return navItems;
	},
	getAdmin: async function (): Promise<{ enabled: NavigationItem[], available: NavigationItem[] }> {
		const [enabled, available]: [NavigationItem[], NavigationItem[]] = await Promise.all([
			admin.get(),
			admin.getAvailable(),
		]);
		return { enabled: enabled, available: available };
	},
	escapeFields: (navItems: NavigationItem[]): void => toggleEscape(navItems, true),
	unescapeFields: (navItems: NavigationItem[]): void => toggleEscape(navItems, false),
};

promisify(admin);

export default admin;
