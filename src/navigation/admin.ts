/* eslint-disable import/no-import-module-exports */
import validator from 'validator';
import winston from 'winston';
import plugins from '../plugins';
import db from '../database';
import pubsub from '../pubsub';
import promisify from '../promisify';
import navigationData from '../../install/data/navigation.json';

// Interface for the structure of navigation items
interface NavigationItem {
	order?: string;
	groups?: string | string[];
	iconClass?: string;
	class?: string;
	route?: string;
	id?: string;
	text?: string;
	textClass?: string;
	title?: string;
	core?: boolean;
	enabled?: boolean;
	[key: string]: string | string[] | boolean | undefined;
}

// Interface for the Admin
interface Admin {
	save: (data: NavigationItem[]) => Promise<void>;
	getAdmin: () => Promise<{ enabled: NavigationItem[], available: NavigationItem[] }>;
	escapeFields: (navItems: NavigationItem[]) => void;
	unescapeFields: (navItems: NavigationItem[]) => void;
	get: () => Promise<NavigationItem[]>;
}

const admin: Admin = {} as Admin;
let cache: NavigationItem[] | null = null;

pubsub.on('admin:navigation:save', () => {
	cache = null;
});

admin.save = async function (data: NavigationItem[]): Promise<void> {
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
};

const fieldsToEscape = ['iconClass', 'class', 'route', 'id', 'text', 'textClass', 'title'];

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

admin.escapeFields = navItems => toggleEscape(navItems, true);
admin.unescapeFields = navItems => toggleEscape(navItems, false);

admin.get = async function (): Promise<NavigationItem[]> {
	if (cache) {
		return cache.map(item => ({ ...item }));
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
	const ids = await db.getSortedSetRange('navigation:enabled', 0, -1) as string[];
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
	const data = await db.getObjects(ids.map(id => `navigation:enabled:${id}`)) as NavigationItem[];
	cache = data.filter(Boolean).map((item) => {
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
};

async function getAvailable(): Promise<NavigationItem[]> {
	const core: NavigationItem[] = navigationData.map((item: NavigationItem) => {
		item.core = true;
		item.id = item.id || '';
		return item;
	});

	const navItems = await plugins.hooks.fire('filter:navigation.available', core) as NavigationItem[];
	navItems.forEach((item) => {
		if (item && !item.hasOwnProperty('enabled')) {
			item.enabled = true;
		}
	});
	return navItems;
}

admin.getAdmin = async function () {
	const [enabled, available] = await Promise.all([
		admin.get(),
		getAvailable(),
	]);
	return { enabled: enabled, available: available };
};


// eslint-disable-next-line @typescript-eslint/no-unsafe-call
promisify(admin);

module.exports = admin;
