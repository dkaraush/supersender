export const {isArray} = Array;
export const isObject = (a : any) : boolean => typeof a === 'object' && a != null && !isArray(a);
export const clone = (a : any) => {
    if (isArray(a))
        return [...a];
    if (isObject(a)) {
        return Object.assign({}, a);
    }
    return a;
}

import { ToLoad } from './config/loader';
export const cloneFull = (a : any) => {
    if (isArray(a))
        return a.map(v => cloneFull(v));
    if (isObject(a) && a.constructor === ({}).constructor) {
        let b = {};
        for (let key in a)
            b[key] = cloneFull(a[key]);
        return b;
    }
    return a;
}

export const arraysAreEqual = (a : Array<any>, b : Array<any>) : boolean => {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; ++i)
        if (a[i] !== b[i])
            return false;
    return true;
};

export const objectMapRecursively = (obj : any, func) => {
    if (typeof obj === 'object' && obj !== null) {
        for (let key in obj) {
            if (typeof obj[key] === 'object' && obj !== null)
                objectMapRecursively(obj[key], func);
            else func(obj, key);
        }
    }
};

// this function does .replace() two times!
// I have copied it from StackOverflow, I should probably rewrite it.
// Using .replace() twice really bothers me
export const replaceAsync = async function (str, regex, asyncFn) {
    const promises = [];
    str.replace(regex, (match, ...args) => {
        const promise = asyncFn(match, ...args);
        promises.push(promise);
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift());
}

import {promisify} from 'util';
import * as fs from 'fs';
export const asyncfs = {
    mkdir: promisify(fs.mkdir),
    readFile: promisify(fs.readFile),
    writeFile: promisify(fs.writeFile),
    exists: promisify(fs.exists),
    isDir: async (path: string) : Promise<boolean> => (await promisify(fs.lstat)(path)).isDirectory()
};

export class FSCache {
    private cache : Map<string, Buffer> = new Map<string, Buffer>();

    async readFile(path: string) : Promise<Buffer> {
        if (this.cache.has(path))
            return this.cache.get(path);
        const buffer = await asyncfs.readFile(path);
        this.cache.set(path, buffer);
        return buffer;
    }

    clear() {
        this.cache.clear();
    }
}

export const stripAnsi = (str: string) : string => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');