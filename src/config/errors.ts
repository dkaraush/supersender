import {bold} from 'colors';
import { PathElement, ResolvedObject, ResolvedString } from './resolver';
import { ToLoad } from './loader';

// symbolsCount(0) => 1
// symbolsCount(9) => 1
// symbolsCount(99) => 2
// symbolsCount(100) => 3
const symbolsCount = (val : number) => {
    return Math.ceil(Math.log10(val + 1));
}

const formatValue = (val : any) => {
    if (val === null || val === undefined)
        return undefined;
    if (val instanceof ResolvedString)
        return ('"'+val.value+'"').green + (val.value !== val.raw ? ' ← ' + ('"'+val.raw+'"').grey : '');
    if (typeof val === 'string')
        return ('"'+val+'"').green;
    if (typeof val === 'object')
        return undefined;
    return val.toString();
};

// =============
// ConfigResolver
// =============
class ConfigResolverError extends Error {
    constructor(name : string, message : string, recursivePath : PathElement[], root : any) {
        super();
        this.name = name;
        this.message = message;
        this.stack = 'ConfigResolver.' + this.name + ':\n' + this.message + '\n\n' +
                     ConfigResolverError.showRecursivePath(recursivePath, root) + '\n'+
                     ('    (recursive parsing path)'.grey) +
                     '\n\n' + this.stack.split('\n').slice(3).join('\n') + '\n';
    }

    static showRecursivePath(path : PathElement[], root : any) : string {
        return path.map((pathElement : PathElement, i : number) => {
            let value = formatValue(pathElement.value);
            return '    ' + ((i+1).toString().padStart(symbolsCount(path.length), ' ') + '. ').yellow + bold(pathElement.scope) + (value ? ' = ' + value : '')
        }).join('\n');
    }
}

class WrongType extends ConfigResolverError {
    path : string;
    constructor(path : string, was: string, shouldbe : string, recursivePath : PathElement[], root : any) {
        super(
            "WrongTypeError",
            `Expected ${bold(shouldbe)} type, but received ${bold(was)} at ${bold(path)}.`,
            recursivePath, root
        );
        this.path = path;
    }
}
class Inheritance extends ConfigResolverError {
    constructor(what : string, from : string, recursivePath: PathElement[], root : any) {
        super(
            "InheritanceError",
            `${bold(from)} is trying to inherit ${bold(what)}!`,
            recursivePath, root
        );
    }
}
class NotAStringInBrackets extends ConfigResolverError {
    constructor(path : string, raw : string, rawPart : string, type : string, recursivePath: PathElement[], root : any) {
        super(
            "NotAStringInBracketsError",
            `While parsing ${bold(path)} string (${('"'+raw+'"').green}), part ${bold(rawPart)} was parsed and it returned a value with ${type} type. We cannot put that in string back :(`,
            recursivePath, root
        );
    }
}

// =============
// ConfigLoader
// =============
class LoadLoop extends Error {
    constructor(path : string[], from : number, to : number) {
        super();
        if (from > to) {
            // swap
            to = from + to;
            from = to - from;
            to = to - from;
        }

        this.name = "ConfigLoader.LoadLoopError";
        this.message = "Including files loop!";
        this.stack = this.name + ':\n' + this.message + '\n\n' +
                     LoadLoop.showRecursivePath(path, from, to) + '\n' + 
                     ('    (recursive including path)').grey + 
                     '\n\n' + this.stack.split('\n').slice(2).join('\n') + '\n';
    }

    static showRecursivePath(path : string[], from : number, to : number) {
        return path.map((filename : string, i : number) => {
            let o = 0;
            if (i == from)
                o = 1;
            if (i > from && i < to)
                o = 2;
            if (i == to)
                o = 3;
            return '    ' + (['  ','.→','↑ ','.←'])[o] + ' ' + 
                    ((i+1).toString().padStart(symbolsCount(path.length), ' ') + '. ').yellow + 
                    bold(filename);
        }).join('\n');
    }
}

// =============
// ConfigExecutor
// =============
class InvalidConfigVariables extends Error {
    constructor(name : string, message : string) {
        super();
        this.name = "ConfigExecutor.InvalidConfigVariablesError";
        this.message = bold(name) + " client " + message;
    }
}

// =============
// ConfigManager
// =============
class ConfigIsNotReady extends Error {
    constructor() {
        super();
        this.name = "ConfigManager.ConfigIsNotReadyError";
        this.message = "Config hasn't been parsed and validated yet";
    }
}
class TokenIsNotFound extends Error {
    constructor() {
        super();
        this.name = "ConfigManager.TokenIsNotFoundError";
        this.message = "Token is not found.";
    }
}
class ActionIsNotFound extends Error {
    constructor() {
        super();
        this.name = "ConfigManager.ActionIsNotFoundError";
        this.message = "Action is not found.";
    }
}
class InvalidValidation extends Error {
    constructor(clientName : string, tokenName : string, actionName : string, message : string) {
        super();
        this.name = "ConfigManager.InvalidValidationError";
        this.message = "Client " + bold(clientName) + " at " + bold(tokenName) + "/" + bold(actionName) + " has bad validation args: " + this.message;
    }
}
class BadRequest extends Error {
    constructor() {
        super();
        this.name = "ConfigManager.BadRequest";
        this.message = "Bad request.";
    }
}

const {isArray} = Array;
const isObject = (a : any) : boolean => typeof a === 'object' && a != null && !isArray(a);

// type() is used only for pretty errors and isn't used in resolving at all!
const typeString = (a : any) : string => {
    if (a instanceof ResolvedObject)
        return 'ResolvedObject';
    if (a instanceof ResolvedString)
        return 'ResolvedString';
    if (a instanceof ToLoad)
        return 'ToLoad(' + a.path + ')';
    if (isObject(a))
        return 'object';
    if (isArray(a))
        return 'array';
    if (a === null || a === undefined)
        return a + "";
    return typeof a;
}
const type = a => bold(typeString(a));

export default {
    type, 

    // ConfigResolver
    WrongType,
    Inheritance,
    NotAStringInBrackets,

    // ConfigLoader
    LoadLoop,

    // ConfigExecutor
    InvalidConfigVariables,

    // ConfigManager
    ConfigIsNotReady,
    TokenIsNotFound,
    ActionIsNotFound,
    InvalidValidation,
    BadRequest
};