import {bold} from 'colors';
import errors from './errors';

/*
                __
               / =)
        .-^^^-/ /
    __/       /
    <__.|_|-|_|
*/

const {isArray} = Array;
const isObject = (a : any) : boolean => typeof a === 'object' && a != null && !isArray(a);
const clone = (a : any) => {
    if (isArray(a))
        return [...a];
    if (isObject(a))
        return Object.assign({}, a);
    return a;
}

class ConfigResolver {
    static readonly separator = '.';
    static readonly separateRegExp = new RegExp('\\' + ConfigResolver.separator, 'g');

    /*
        cantInherit() answers to the question: "Can `from` object actually inherit `that` object?"
        So, it takes path of both of them, splits them into directories and compares the equation of the smallest part.
    */
    private static cantInherit(from : string, that : string) : boolean {
        let fromDirs = from.split(this.separateRegExp),
            thatDirs = that.split(this.separateRegExp);
        if (thatDirs.length > fromDirs.length)
            return false;
        return arraysEqual(fromDirs.slice(0, fromDirs.length), thatDirs.slice(0, fromDirs.length));
    }

    /*
        removeResolvedClasses() is executed after resolving the whole object
        It recursively replaces all ResolvedObject and ResolvedString objects into their normal values.
    */
    private static removeResolvedClasses(x : any) : any {
        if (x instanceof ResolvedObject)
            x = clone(x);
        if (x instanceof ResolvedString)
            x = x.value;

        if (isObject(x) || isArray(x)) {
            for (let key in x) {
                x[key] = this.removeResolvedClasses(x[key]);
            }
        }
        return x;
    }

    /*
        resolve() is the main and the only public method in this class
        Basically, it does two functions:
            1. resolving inherits
            2. resolving all values recursively (in the source object only)
    */
    public static resolve(
        root : any, 
        path : ResolvedString | string, 
        pointer? : Pointer, 
        first : boolean = true, 
        all : boolean = true, 
        recursivePath : PathElement[] = []
    ) : ResolvedObject {
        // do not make changes to the root itself:
        if (first)
            root = clone(root);

        if (typeof path === 'string')
            path = this.resolveString('~', path, root, clone(recursivePath));
    
        if (pointer === undefined)
            pointer = this.access(path.toString(), root, clone(recursivePath));

        let object = pointer.get();
        if (!isObject(object) && !isArray(object))
            throw new errors.WrongType(path.toString(), errors.type(object), 'object | array', recursivePath, root);

        if (object instanceof ResolvedObject)
            return object;

        if (isObject(object) && object.inherits)
            this.resolveInherits(object, path, root, recursivePath);

        if (all) {
            for (let key of Object.keys(object)) {
                let value = object[key];
                let scope = path + this.separator + key;
                if (typeof value === 'string') {
                    object[key] = this.resolveString(scope, value, root, recursivePath);
                } else if (typeof value === 'object' && 
                           !(value instanceof ResolvedString) && 
                           !(value instanceof ResolvedObject)) {
                    object[key] = this.resolve(root, scope, new Pointer(object, key), false, true, recursivePath);
                }
            }
        }

        if (first)
            return this.removeResolvedClasses(object);
        let resolved = new ResolvedObject(object);
        pointer.set(resolved);
        return resolved;
    }

    /*
        resolveInherits() tries to "inherit" another objects: 
            finds each object by their pathes and put all values into source object
    */
    private static resolveInherits(
        object : any, 
        path : ResolvedString, 
        root : any, 
        recursivePath : PathElement[] = []
    ) {
        let inherits = object.inherits;
        if (typeof inherits === 'string' || inherits instanceof ResolvedString)
            inherits = [ inherits ];
            
        if (isArray(inherits)) {
            for (let i = inherits.length - 1; i >= 0; --i) {
                let inheritPath = path.toString() + '.inherits[' + i + ']';
                let inherit = inherits[i];
                if (!(inherit instanceof ResolvedString))
                    inherit = this.resolveString(inheritPath, inherit, root, recursivePath);
                if (typeof inherit !== 'string' && !(inherit instanceof ResolvedString))
                    throw new errors.WrongType(inheritPath, errors.type(inherit), 'string', recursivePath, root);
                
                if (this.cantInherit(path.toString(), inherit.toString())) {
                    throw new errors.Inheritance(
                        inherit.toString(), 
                        path.toString(), 
                        cloneAndAppend(
                            recursivePath,
                            <PathElement> {scope: inheritPath, value: inherit}
                        ), root);
                }

                let inheritObject = this.access(
                    inherit.toString(), 
                    root, 
                    cloneAndAppend(recursivePath, <PathElement> {scope: inheritPath, value: inherit})
                ).get();
                if (!isObject(inheritObject)) {
                    throw new errors.WrongType(inherit.toString(), errors.type(inheritObject), 'object', cloneAndAppend(
                        recursivePath, 
                        <PathElement> {scope: inheritPath, value: inherit},
                        <PathElement> {scope: inherit.toString(), value: inheritObject}
                    ), root);
                }

                for (let key of Object.keys(inheritObject))
                    if (typeof object[key] === 'undefined')
                        object[key] = inheritObject[key];
            }

        } else {
            // TODO: warn: inherits is not a string and an array; can't do inherit
        }

        delete object.inherits;
    }
    
    /*
        resolveString() tries to replace all brackets in string with their values
        Also, if it accesses another string, it will resolve it, too, and save its resolved state.
    */
	private static resolveString(
        from : string,
        source : string, 
        root : any, 
        recursivePath : PathElement[] = []
    ) : ResolvedString {
        const bracketsRegExp = /\{\{([^\{\}]+)\}\}/g;
        let string = source;
        while (bracketsRegExp.test(string)) {
            string = string.replace(bracketsRegExp, (_ : any, path : string) : string => {
                let pointer = this.access(path, root, cloneAndAppend(recursivePath, <PathElement> {
                    scope: from
                }));
                let val = pointer.get();
            
                if (typeof val === 'string') {
                    val = this.resolveString(from, val, root, cloneAndAppend(recursivePath, <PathElement> {
                       scope: from
                    }));
                    pointer.set(val);
                    return val.toString();
                } else if (val instanceof ResolvedString) {
                    return val.toString();
                } else if (typeof val === 'number') {
                    return val.toString();
                } else if (typeof val === 'boolean') {
                    return val ? 'true' : 'false';
                } else
                    throw new errors.NotAStringInBrackets(from, string, path.toString(), errors.type(val), recursivePath, root);
            });
        }
        return new ResolvedString(string, source);
    }

    /*
        access() tries to access value by given path in string
        For example, if object is { a: { b: 1 } }, access("a.b", ...) should return 1

        Basically, it returns not a value itself, but a pointer to it.
        So, another function can change its value afterwards and it will be saved in root object.
    */
    private static access(
        path: ResolvedString | string, 
        root: any, 
        recursivePath : PathElement[] = []
    ) : Pointer {
        let dirs = path.toString().split(this.separateRegExp);
        let o = root;
        let lastParent = o;
        let passedPath = [];
        for (let i = 0; i < dirs.length; ++i) {
            let dir = dirs[i], isLast = (i == dirs.length - 1);
            lastParent = o;
            o = o[dir];
            passedPath.push(dir);
            let passedPathString = passedPath.join(this.separator);

            if (o === undefined)
                throw new errors.WrongType(passedPathString, errors.type(o), isLast ? 'any' : 'object', recursivePath, root);

            if (isArray(o) && !isLast)
                throw new errors.WrongType(passedPathString, errors.type(o), 'object', recursivePath, root);

            if (isObject(o) && !(o instanceof ResolvedObject) &&
                !(o instanceof ResolvedString) &&
                (isLast || typeof o[dirs[i+1]] === 'undefined') &&
                !recursivePath.map(el => el.scope.toString()).includes(passedPathString)) {
                o = this.resolve(root, passedPathString, new Pointer(lastParent, dir), false, false, cloneAndAppend(recursivePath, <PathElement> {
                    scope: passedPathString,
                    value: o
                }));
            }

        }
        return new Pointer(lastParent, dirs[dirs.length-1]);
    }
}

/*
    Class Pointer is a simple class with stupid intention.
    In short, it gives a pointer to a value in the object, 
        so anyone can take this value and change it in the object itself.
    Basically, it just stores a parent object and the key of the value.
*/
class Pointer {
    parent : object;
    key : string;
    constructor(parent : object, key : string) {
        this.parent = parent;
        this.key = key;
    }

    get() {
        return this.parent[this.key];
    }
    set(val : any) {
        this.parent[this.key] = val;
    }
}

const cloneAndAppend = (array : Array<any>, ...elements : any[]) => {
    return array.concat(elements);
}
const arraysEqual = (a : Array<any>, b : Array<any>) : boolean => {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; ++i)
        if (a[i] !== b[i])
            return false;
    return true;
};

class ResolvedObject extends Object {
    constructor(obj : Object) {
        super(obj);
    }
}

// I didn't figure out how to extend actual String and save an another variant of it.
// Anyway, typeof (new ResolvedString()) === 'object', even if it extends String.
class ResolvedString {
    raw : string;
    value : any;
    constructor(resolved : any, raw : string) {
        this.value = resolved;
        this.raw = raw;
    }

    toString() {
        return this.value.toString();
    }
}
interface PathElement {
    scope: string;
    value?: any;
}

export { PathElement, ResolvedObject, ResolvedString };
export default ConfigResolver;