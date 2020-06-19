import {homedir} from 'os';
import {promisify} from 'util';
import * as YAML from 'yaml';

import errors from './errors';
import ConfigResolver, { ResolvedString } from './resolver';
import {asyncfs as fs, FSCache} from '../utils';
import {join, resolve} from 'path';

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
        path : string = join(homedir(), '/.supersender/'),
        fscache? : FSCache
    ) : Promise<any> {
        let raw = (await (fscache || fs).readFile(join(path, filename))).toString();

        return YAML.parse(raw, <YAML.ParseOptions> {
            prettyErrors: true,
            customTags: this.tags.concat(ToLoad.tag(path, fscache || null))
        });
    }
}

export class ToLoad {
    public $TYPE = 'TOLOAD';
    public static tag (rootpath : string, fs : FSCache | null) {
        return {
            tag: '!load',
            identify: x => false,
            resolve: ToLoad.create.bind(null, fs, rootpath)
        };
    }

    private rootpath : string;
    private fs: FSCache | null;
    path: string;
    private constructor(rootpath : string, fs : FSCache | null, path: string) {
        this.rootpath = rootpath;
        this.fs = fs;
        this.path = path;
    }

    async load(resolvedPath: ResolvedString) : Promise<any> {
        return await ConfigLoader.load(resolvedPath.value, this.rootpath, this.fs);
    }

    public static create(
        fs: FSCache | null,
        rootpath : string,
        doc : YAML.ast.Document,
        cst : YAML.cst.BlockValue
    ) : ToLoad {
        return new ToLoad(rootpath, fs, cst.strValue);
    }
}

export default ConfigLoader;