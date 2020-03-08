import {homedir} from 'os';
import {promisify} from 'util';
import {
    readFile as _readFile,
    exists as _exists,
    mkdir as _mkdir
} from 'fs';
import * as YAML from 'yaml';
import errors from './errors';

const readFile = promisify(_readFile);
const exists = promisify(_exists);
const mkdir = promisify(_mkdir);

const recursiveObjectMap = (obj : any, func) => {
    if (typeof obj === 'object' && obj !== null) {
        for (let key in obj) {
            if (typeof obj[key] === 'object' && obj !== null)
                recursiveObjectMap(obj[key], func);
            else func(obj, key);
        }
    }
};

class LoaderTag {
    private path : string;
    private recursivePath : string[];
    constructor(path : string, recursivePath : string[]) {
        this.path = path;
        this.recursivePath = recursivePath;
    }

    public tag = {
        tag: '!load',
        identify: x => false,
        resolve: this.resolve.bind(this)
    };
    resolve(doc, cst) {
        let filename = cst.strValue;
        let index;
        if ((index = this.recursivePath.indexOf(filename)) >= 0) {
            this.recursivePath.push(filename);
            throw new errors.LoadLoop(this.recursivePath, index, this.recursivePath.length - 1);
        }

        return async (obj, key) => {
            obj[key] = await ConfigLoader.load(filename, true, this.path, [...this.recursivePath]);
        };
    }

    async loadAll(obj : any) {
        let promises = [];
        recursiveObjectMap(obj, (obj : any, key : string) => {
            if (typeof obj[key] === 'function')
                promises.push(obj[key](obj, key));
        });
        return Promise.all(promises);
    }
}
class FileTag {
    static tag = "!file";
    static identify = () => false;
    static resolve(doc, cst) {
        return new FileTag(cst.strValue);
    }

    path : string;
    constructor(path : string) {
        this.path = path;
    }

    // TODO: actually load!
}

class ConfigLoader {
    static tags : Array<any> = [ FileTag ];

    static async load(
        filename : string,
        multiple : boolean = true,
        path : string = homedir() + '/.supersender/',
        recursivePath : string[] = new Array()
    ) : Promise<any> {
        if (path[path.length - 1] !== '/')
            path += '/';

        recursivePath.push(filename);

        let raw = (await readFile(path + filename)).toString();
        let tags = this.tags, loader;
        if (multiple) {
            loader = new LoaderTag(path, recursivePath);
            tags = tags.concat(loader.tag);
        }

        let parsed = YAML.parse(raw, <YAML.ParseOptions> {
            prettyErrors: true,
            customTags: tags
        });
        if (multiple)
            await loader.loadAll(parsed);

        return parsed;
    }
}

export default ConfigLoader;