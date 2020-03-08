/*
    Filesystem structure:
    
    ~/.supersender/
        src/
            client1/
                index.yaml
                ...
                templates/
                    ua/
                        confirm-mail/
                            body.html
                            subject.txt
            client2/
                index.yaml
        dist/
            ... (copied version of the same files) ...
*/

import {homedir} from 'os';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import {
    parse as parsePath, 
    join as joinPathes
} from 'path';
import {promisify} from 'util';
import ConfigLoader from './loader';
import errors from './errors';
import { bold } from 'colors';
import ConfigResolver from './resolver';

const ValidationLevels = {
    'nothing': 0,
    'configFiles': 1,
    'allActions': 2,
    'allActionArgs': 3,
    'driverArgs': 4,
    'all': 5
};
const indexFilename = 'index.yaml';

const lstat = promisify(fs.lstat);
const mkdir = promisify(fs.mkdir);
const exists = promisify(fs.exists);
const readdir = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);

const overrideLogger = (fromFunc, func : () => any[]) => (...args : any[]) => fromFunc(...func(), ...args)

class ConfigManager {
    public static readonly validationLevelSrc =  ValidationLevels.all;
    public static readonly validationLevelDist = ValidationLevels.configFiles;
    
    static async getInstance (
        shouldWatch : boolean = true,
        srcPath : string = joinPathes(homedir(), '/.supersender/src/'),
        distPath : string = joinPathes(homedir(), '/.supersender/dist/')
    ) : Promise<ConfigManager> {
        if (!(await this.mkdirIfNotExist(srcPath)))
            await this.createExample(srcPath);
        await this.mkdirIfNotExist(distPath);

        let dist = await Config.init(distPath, ConfigManager.validationLevelDist);
        let src =  await Config.init(srcPath, ConfigManager.validationLevelSrc);

        return new ConfigManager(shouldWatch, src, dist);
    }
    private static async mkdirIfNotExist(path : string) : Promise<boolean> {
        if (!(await exists(path))) {
            verbose("path", bold(path), "doesn't exist => mkdir -p", bold(path));
            await mkdir(path, { recursive: true });
            return false;
        }
        return true;
    }
    private static async createExample(path : string) {
        verbose("putting example config files into new src/ folder");
        for (let filepath in exampleConfig) {
            let content = exampleConfig[filepath];
            let parsedFilepath = parsePath(filepath);
            await this.mkdirIfNotExist(joinPathes(path, parsedFilepath.dir));
            await writeFile(joinPathes(path, filepath), content);
        }
    }

    public status : boolean = false;

    public shouldWatch : boolean;
    public src : Config;
    public dist : Config;
    private watcher : ConfigWatcher;
    private constructor(shouldWatch : boolean, src : Config, dist : Config) {
        this.shouldWatch = shouldWatch;
        this.src = src;
        this.dist = dist;

        if (this.shouldWatch)
            this.watcher = new ConfigWatcher(this.src.path, this.updateSource.bind(this));
    }
    
    private async updateSource() {
        if (this.src.updating)
            this.src.updateNext = true;
        else
            this.src.update();
    }

    public async execute(tokenName : string, actionName : string, req : object) {
        return this.dist.execute(tokenName, actionName, req);
    }
}

class Config {

    public updating : boolean = false;
    public updateNext : boolean = false;

    public readonly path : string;
    public readonly validationLevel : number;
    private clients : Map<string, ConfigClient>;
    private constructor(path : string, validationLevel : number) {
        this.path = path;
        this.validationLevel = validationLevel;
        this.clients = new Map<string, ConfigClient>();
    }

    static async init(
        path : string,
        validationLevel : number
    ) : Promise<Config> {
        let config = new Config(path, validationLevel);
        await config.update();
        return config;
    }

    async update() {
        this.updating = true;

        let clientNames = await this.getClientNames();
        for (let clientName of clientNames) {
            if (!this.clients.has(clientName))
                this.clients.set(clientName, new ConfigClient(clientName, this.path, this.validationLevel));
            await this.clients.get(clientName).update();
        }

        for (let clientName of Array.from(this.clients.keys()))
            if (!clientNames.includes(clientName))
                this.clients.delete(clientName);

        // TODO: make more flexible system
        if (this.updateNext) {
            this.updateNext = false;
            await this.update();
        }

        this.updating = false;
    }

    async getClientNames() : Promise<Array<string>> {
        return (await readdir(this.path)).filter(
            async name => (await lstat(joinPathes(this.path, name))).isDirectory()
        );
    }

    async execute(
        tokenName : string,
        actionName : string,
        req : object
    ) {
        let client = this.findClientByToken(tokenName);
        if (client == null || !client.status)
            throw new errors.TokenIsNotFound();
        return client.execute(tokenName, actionName, req);
    }

    findClientByToken(tokenName : string) : ConfigClient {
        for (let clientName of Array.from(this.clients.keys()))
            if (this.clients.get(clientName).tokens.includes(tokenName))
                return this.clients.get(clientName);
        return null;
    }
}

const {isArray} = Array;
const isObject = (a : any) : boolean => typeof a === 'object' && a != null && !isArray(a);
const clone = (a : any) => {
    if (isArray(a))
        return [...a];
    if (isObject(a))
        return Object.assign({}, a);
    return a;
}

class ConfigClient {
    public static readonly aliases = {
        in: {
            tokenName: "token-name",
            actionName: "action-name",
            request: "request"
        },
        out: {
            actions: "actions",
            tokens: "tokens",
            requestValidation: "request-validation",
            result: "result"
        }
    };

    public readonly name : string;
    public readonly path : string;
    public readonly validationLevel : number;
    public status : boolean = false;

    constructor(
        name : string,
        path : string, 
        validationLevel : number
    ) {
        this.name = name;
        this.path = path;
        this.validationLevel = validationLevel;        
    }

    public raw : any;
    public tokens : Array<string>;
    public actions : Array<string>;

    public async update() {
        try {
            await this.tryToUpdate();
        } catch (e) {
            this.status = false;
            error('failed to update ' + bold(this.name) + ' client:', e);
        }
    }
    private async tryToUpdate() {
        this.status = false;
        this.raw = await ConfigLoader.load(indexFilename, true, joinPathes(this.path, this.name));
        this.checkKeys(this.raw, Object.values(ConfigClient.aliases.out));

        this.tokens = Object.keys(this.raw.tokens);
        this.actions = Object.keys(this.raw.actions);

        await this.validate();
        this.status = true;
    }

    private checkKeys(root : any, keys : Array<string>) {
        for (let key of keys)
            if (!isObject(root[key]))
                throw new errors.InvalidConfigVariables(this.name, `doesn't have ${bold('`'+key+'`')} variable in config`);
    }

    private async validate() {
        if (this.tokens.length == 0)
            warn(bold(this.name) + ' has 0 tokens.');
        if (this.actions.length == 0)
            warn(bold(this.name) + ' has 0 actions.');
        
        if (this.validationLevel >= ValidationLevels.allActions) {
            let i = 0, N = this.tokens.length * this.actions.length;
            let addPercent = ()=>['['+formatNum(Math.round(i/N*100), 3, ' ')+'%]', bold(this.name)];
            let log = overrideLogger(global.log, addPercent),
                error = overrideLogger(global.error, addPercent);
            for (let tokenName of this.tokens) {
                for (let actionName of this.actions) {
                    log(tokenName+'/'+actionName);
                    await this.execute(tokenName, actionName, null, true);
                    i++;
                }
            }
        }
    }

    public async execute(
        tokenName : string,
        actionName : string, 
        req : object,
        test : boolean = false
    ) {
        if (!this.actions.includes(actionName))
            throw new errors.ActionIsNotFound();
        if (!this.tokens.includes(tokenName))
            throw new errors.TokenIsNotFound();
        
        let root = clone(this.raw);
        root[ConfigClient.aliases.in.actionName] = actionName;
        root[ConfigClient.aliases.in.tokenName]  = tokenName;

        let validation = ConfigResolver.resolve(root, ConfigClient.aliases.out.requestValidation);
        if (typeof validation !== 'object') // could be null, means empty object
            throw new errors.InvalidValidation(this.name, tokenName, actionName, 'validation is not an object');

        if (!test) {
            let request = this.formatRequest(req, validation);
        } else {
            if (this.validationLevel >= ValidationLevels.allActionArgs) {
                // TODO: dima left the game, i hope he will continue
            }
        }
    }

    private validateType(arg : string, value : any, type : string) : boolean {
        switch (type) {
            case "string":
                return typeof value === 'string';
            case "number":
                return typeof value === 'number';
            case "boolean":
                return typeof value === 'boolean';
            case "array":
                return isArray(value);
            case "object":
                return isObject(value);
            default:
                throw 'argument ' + bold('`'+arg+'`') + ' has bad type: ' + ('"'+type+'"').green; 
        }
    } 
    private validateTypes(arg : string, value : any, typeString : string | string[]) : boolean {
        let types = (
            typeof typeString === 'string' ? typeString.trim().split(/\s*\|\s*/g) : typeString
        ).map(type => type.toLowerCase())
        for (let type of types)
            if (this.validateType(arg, value, type))
                return true;
        return false;
    }
    private validateArg(arg: string, value : any, options : any) : boolean {
        if (typeof options === 'string')
            return this.validateTypes(arg, value, options);

        if (typeof options === 'object') {
            if (options === null) // empty
                return true;
            if (options.required && typeof options.default !== 'undefined')
                throw 'argument ' + bold('`'+arg+'`') + ' has both required and default';

            if (options.required && (typeof value === 'undefined' || value === null))
                return false;
            if (options.type)
                return this.validateTypes(arg, value, options.type);
        }
    }
    private validateArgs(body : any, validation : any) : boolean {
        if (validation === null)
            return true;
        for (let key in validation)
            if (!this.validateArg(key, body[key], validation[key]))
                return false;
        return true;
    }

    private formatRequest(body : any, validation : any) {

    }
}

class ConfigWatcher {
    public static readonly waitAfterChange : number = 1000 * 5; // wait 5sec, until changes will stop happening
    public lastChange : number = 0;

    public active : boolean = false;
    public readonly path : string;
    public readonly listener : Function;
    private watcher : chokidar.FSWatcher;
    constructor(path : string, listener : Function) {
        this.path = path;
        this.listener = listener;

        this.watcher = chokidar.watch(this.path, {
            ignored: /(^|[\/\\])\../,
            persistent: true
        });
        this.watcher.on('all', this.onChange.bind(this));
    }

    private onChange(eventName : string, err : any) {
        if (eventName === 'error') {
            error("failed to watch for changes: " + err);
            return;
        }

        if (!this.active)
            verbose('caught changes:', eventName, err, '=> waiting ~' + (ConfigWatcher.waitAfterChange/1000) + 'sec to actually make changes');
        
        this.active = true;
        let lastChange = this.lastChange = Date.now();
        setTimeout(() => {
            if (lastChange === this.lastChange) {
                this.listener();
                this.active = false;
                this.lastChange = 0;
            }
        }, ConfigWatcher.waitAfterChange);
    }
}


const exampleConfig = {

//     'tokens.yaml': `
// # default tokens.yaml from example for demonstration
// # here we are declaring all available tokens

// tokens:
//     example-token:
//         client: "example-client"

// # \`token\` object would be passed to client \`index.yaml\`
// # However, \`tokens\` object is hardcoded, so application can access all possibly available tokens.
// token:
//     inherits: "tokens.{{token-name}}"
// `,

    'example-client/index.yaml': `
# this config file would be executed in two steps:
# 1. \`request-validation\` to validate arguments, that are came from request
#    available scopes: {{token-name}}, {{action-name}}
# 2. \`result\` to actually execute an action itself
#    available scopes: {{token-name}}, {{action-name}}, {{request}}
#
# This way, we ask config file for validation rules and do not allow to get {{request}}, so
#   the validation would not depend on the request object.

# \`actions\` and \`tokens\` objects are hardcoded, so application will know all possibly available actions and tokens
actions:
    !load "actions.yaml"
tokens:
    example-token:

token:
    inherits: tokens.{{token-name}}

request-validation:
    inherits: actions.{{action-name}}.args
result:
    inherits: actions.{{action-name}}.res

# Try now this example at:
# /supersend/example-token/hello
# body: { username: "test" }
`,

    'example-client/actions.yaml': `
hello:
    args:
        username: {type: String, default: "world"}
    res:
        driver: 'test'
        message: 'hello, {{request.username}}'
`

};

export default ConfigManager;