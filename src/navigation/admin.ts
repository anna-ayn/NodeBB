'use strict';

import validator from 'validator';
import winston from 'winston';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call 
import plugins from '../plugins';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
import db from '../database';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
import pubsub from '../pubsub';


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
    [key: string]: any;
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
    const ids: string[] = await db.getSortedSetRange('navigation:enabled', 0, -1);
    await db.deleteAll(ids.map(id => `navigation:enabled:${id}`));
    await db.setObjectBulk(bulkSet);
    await db.delete('navigation:enabled');
    await db.sortedSetAdd('navigation:enabled', order, order);
};

admin.getAdmin = async function (): Promise<{ enabled: NavigationItem[], available: NavigationItem[] }> {
    const [enabled, available] = await Promise.all([
        admin.get(),
        getAvailable(),
    ]);
    return { enabled: enabled, available: available };
};

const fieldsToEscape: (keyof NavigationItem)[] = ['iconClass', 'class', 'route', 'id', 'text', 'textClass', 'title'];

admin.escapeFields = (navItems: NavigationItem[]): void => toggleEscape(navItems, true);
admin.unescapeFields = (navItems: NavigationItem[]): void => toggleEscape(navItems, false);

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

admin.get = async function (): Promise<NavigationItem[]> {
    if (cache) {
        return cache.map(item => ({ ...item }));
    }
    const ids: string[] = await db.getSortedSetRange('navigation:enabled', 0, -1);
    const data: NavigationItem[] = await db.getObjects(ids.map(id => `navigation:enabled:${id}`));
    cache = data.filter(Boolean).map((item) => {
        if (item.hasOwnProperty('groups')) {
            try {
                item.groups = JSON.parse(item.groups as string);
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
    const core: NavigationItem[] = require('../../install/data/navigation.json').map((item: NavigationItem) => {
        item.core = true;
        item.id = item.id || '';
        return item;
    });

    const navItems: NavigationItem[] = await plugins.hooks.fire('filter:navigation.available', core);
    navItems.forEach((item) => {
        if (item && !item.hasOwnProperty('enabled')) {
            item.enabled = true;
        }
    });
    return navItems;
}

require('../promisify')(admin);
module.exports = admin;


