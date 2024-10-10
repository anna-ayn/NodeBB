"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const validator_1 = __importDefault(require("validator"));
const winston_1 = __importDefault(require("winston"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
const plugins_1 = __importDefault(require("../plugins"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
const database_1 = __importDefault(require("../database"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
const pubsub_1 = __importDefault(require("../pubsub"));
const admin = {};
let cache = null;
pubsub_1.default.on('admin:navigation:save', () => {
    cache = null;
});
admin.save = function (data) {
    return __awaiter(this, void 0, void 0, function* () {
        const order = Object.keys(data);
        const bulkSet = [];
        data.forEach((item, index) => {
            item.order = order[index];
            if (item.hasOwnProperty('groups')) {
                item.groups = JSON.stringify(item.groups);
            }
            bulkSet.push([`navigation:enabled:${item.order}`, item]);
        });
        cache = null;
        pubsub_1.default.publish('admin:navigation:save');
        const ids = yield database_1.default.getSortedSetRange('navigation:enabled', 0, -1);
        yield database_1.default.deleteAll(ids.map(id => `navigation:enabled:${id}`));
        yield database_1.default.setObjectBulk(bulkSet);
        yield database_1.default.delete('navigation:enabled');
        yield database_1.default.sortedSetAdd('navigation:enabled', order, order);
    });
};
admin.getAdmin = function () {
    return __awaiter(this, void 0, void 0, function* () {
        const [enabled, available] = yield Promise.all([
            admin.get(),
            getAvailable(),
        ]);
        return { enabled: enabled, available: available };
    });
};
const fieldsToEscape = ['iconClass', 'class', 'route', 'id', 'text', 'textClass', 'title'];
admin.escapeFields = (navItems) => toggleEscape(navItems, true);
admin.unescapeFields = (navItems) => toggleEscape(navItems, false);
function toggleEscape(navItems, flag) {
    navItems.forEach((item) => {
        if (item) {
            fieldsToEscape.forEach((field) => {
                if (item.hasOwnProperty(field)) {
                    item[field] = validator_1.default[flag ? 'escape' : 'unescape'](String(item[field]));
                }
            });
        }
    });
}
admin.get = function () {
    return __awaiter(this, void 0, void 0, function* () {
        if (cache) {
            return cache.map(item => (Object.assign({}, item)));
        }
        const ids = yield database_1.default.getSortedSetRange('navigation:enabled', 0, -1);
        const data = yield database_1.default.getObjects(ids.map(id => `navigation:enabled:${id}`));
        cache = data.filter(Boolean).map((item) => {
            if (item.hasOwnProperty('groups')) {
                try {
                    item.groups = JSON.parse(item.groups);
                }
                catch (err) {
                    if (err instanceof Error) {
                        winston_1.default.error(err.stack);
                    }
                    else {
                        winston_1.default.error('Unknown error', err);
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
        return cache.map(item => (Object.assign({}, item)));
    });
};
function getAvailable() {
    return __awaiter(this, void 0, void 0, function* () {
        const core = require('../../install/data/navigation.json').map((item) => {
            item.core = true;
            item.id = item.id || '';
            return item;
        });
        const navItems = yield plugins_1.default.hooks.fire('filter:navigation.available', core);
        navItems.forEach((item) => {
            if (item && !item.hasOwnProperty('enabled')) {
                item.enabled = true;
            }
        });
        return navItems;
    });
}
require('../promisify')(admin);
module.exports = admin;
