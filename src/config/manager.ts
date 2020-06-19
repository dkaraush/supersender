import {homedir} from 'os';
import {join, dirname} from 'path';

import {asyncfs as fs, clone, FSCache, cloneFull} from '../utils';
import ConfigLoader from './loader';
import ConfigResolver from './resolver';

export default class ConfigManager {
    private static readonly aliases = {
        tokenName: "token-name",
        actionName: "action-name",
        request: "request",
        result: "result",
        driver: "driver"
    };
    private static readonly indexFilename = "index.yaml";
    
    static async init(
        path: string = join(homedir(), "/.supersender/")
    ) : Promise<ConfigManager> {
        if (!(await fs.exists(path)) ||
            !(await fs.exists(join(path, ConfigManager.indexFilename))))
            await ConfigManager.generateDefault(path);

        const fscache = new FSCache();
        return new ConfigManager(
            path, 
            await ConfigLoader.load(ConfigManager.indexFilename, path, fscache),
            fscache
        );
    }

    private fs : FSCache;
    private path : string;
    private config : any;
    private constructor(path: string, config: any, fs : FSCache) {
        this.path = path;
        this.config = config;
        this.fs = fs;
    }

    public async update() {
        this.fs.clear();
        this.config = await ConfigLoader.load(
            ConfigManager.indexFilename, this.path, this.fs
        );
    }

    public async execute(token: string, action: string, request: any) : Promise<any> {
        let config = cloneFull(this.config);
        config[ConfigManager.aliases.tokenName] = token;
        config[ConfigManager.aliases.actionName] = action;
        config[ConfigManager.aliases.request] = request;
        
        return await ConfigResolver.resolve(config, ConfigManager.aliases.result);
    }

    private static async generateDefault(path: string) {
        if (!(await fs.exists(path)))
            await fs.mkdir(path);
        
        for (let filepath in ConfigManager.defaultConfig) {
            let fullpath = join(path, filepath),
                dirpath = dirname(fullpath);
            if (!(await fs.exists(dirpath)) || !(await fs.isDir(dirpath))) {
                await fs.mkdir(dirpath, {recursive: true});
            }
            await fs.writeFile(fullpath, ConfigManager.defaultConfig[filepath]);
        }
    }
    private static readonly defaultConfig = {
'index.yaml':
`
# This is the root config
# Here you can manage tokens, actions, environments, driver args and so on
# On each request we parse this config with additional values: {{${ConfigManager.aliases.tokenName}}}, {{${ConfigManager.aliases.actionName}}} and {{${ConfigManager.aliases.request}}}

# At the end of parsing, we must have {{${ConfigManager.aliases.result}}} object with {{${ConfigManager.aliases.driver}}} key and other parameters for driver
# Please, check which parameters does driver require. Otherwise, the error message will be shown up (in server logs and HTTP response).

# For example, token handling:
tokens:
    if-dev-784gfvgcd8f83y8:
        env: "dev"
        client: "test-client"
    if-prod-31239sda9892ds:
        env: "prod"
        client: "test-client"
token:
    inherits: "tokens.{{${ConfigManager.aliases.tokenName}}}"

# Actions loading:
actions:
    !load "{{token.client}}/actions.yaml"

# "Executing" request's method:
${ConfigManager.aliases.result}:
    inherits: "actions.{{${ConfigManager.aliases.actionName}}}"
`,

'test-client/actions.yaml': 
`
hello-world:
    ${ConfigManager.aliases.driver}: "server-log"
    message: "Hello world, {{${ConfigManager.aliases.request}.username}}!. It is a {{token.env}} environment."
`};
        
}