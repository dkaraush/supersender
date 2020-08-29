import * as yaml from 'yaml';
import * as fs from 'fs';
import { promisify } from 'util';
import { join as joinPathes } from 'path';

type LoggingContext = {
    disabled: boolean;
    ident: string;
    sub: (subident: string) => LoggingContext;
    log: (...args: any[]) => void;
}

// for good logging
export const makeBaseContext = (disabled: boolean = false) : LoggingContext => ({
    disabled,
    ident: "",
    sub: function (ident) { return {...this, ident: this.ident + ident } },
    log: function (...a) { if (!this.disabled) console.log(this.ident + a[0], ...a.slice(1)) }
});

type FieldsIterator = {
    owner: Bubble;
    next: (context: LoggingContext) => Promise<{parent : Bubble, field : string} | undefined>;
};
type Bubble = {
    resolving: boolean;
    resolved?: any;
    chaincache: any;

    path: string;
    parent?: Bubble;

    accessChain: (context: LoggingContext, path: string) => Promise<Bubble>;
    bubblizeChild: (key: string | number, value: any) => void;
    childBubble: (context: LoggingContext, fieldname: string) => Promise<Bubble>;
    fieldsIterator: (context: LoggingContext, searchedFieldName?: string, setOfParentClasses?: {[key: string]: number}) => Promise<FieldsIterator>; 
    resolve: (context: LoggingContext) => any;
} & (BubbleString | BubbleArray | BubbleObject | BubblePrimitive);

type BubbleString = {
    type: "string";
    content: string;
};
type BubbleArray = {
    type: "array";
    content: Bubble[];
};
type BubbleObject = {
    type: "object";
    content: {[key: string]: Bubble, [num: number]: Bubble};
};
type BubblePrimitive = {
    type: "primitive";
    content: any;
};

const BubbleType = (elem: any) =>
    typeof elem === "string" ? "string" :
    Array.isArray(elem) ? "array" :
    typeof elem === "object" && elem !== null ? "object" :
    "primitive";

export function bubble (
    content : any,
    loader : (context: LoggingContext, filename: string) => Promise<any>,
    parent: Bubble | undefined = undefined,
    root : any = content,
    name : string | number = '~'
) {
    let b : Bubble = {
        chaincache: {}, // we cache accessing certain chunks to decrease logging and increase speed
        resolved: undefined, // cache for resolved content
        accessChain: async (context, path) => { // returns bubble
            if (root.chaincache[path])
                return root.chaincache[path];
            context.log(`accessing chain: ${path} for ${b.path}`)
            const pathSplitted = path.split(".");
            let tempContent = root;
            for (let i = 0; i < pathSplitted.length; i++) {
                const pathPartName = pathSplitted[i];
                const subPath = tempContent.path + "/" + pathPartName;
                if (!root.chaincache[subPath]) {
                    context.log(`|- get chain elem "${pathPartName}" of path "${path}" of elem ${tempContent.path}`)
                    root.chaincache[subPath] = await tempContent.childBubble(context.sub("|  "), pathPartName);
                }
                tempContent = root.chaincache[subPath];
            }
            return root.chaincache[path] = tempContent;
        },
        // helper for initial recursive bubblizing and for yaml loading
        bubblizeChild: (key, value) => { 
            b.content[key] = bubble(value, loader, b, root, key);
        },
        content,
        // access child bubble, if it is inside our object or somewhere in parent classes
        childBubble: async (context, fieldname) => {
            const iter = await b.fieldsIterator(context, fieldname);
            let next;
            while (next = await iter.next(context)) {
                if (next.field === fieldname) {
                    return next.parent.content[fieldname];
                }
            }
            throw new Error("no such field: "+fieldname+" for "+b.path);
        },
        // EITHER searching for one field OR returning all fields
        fieldsIterator: async (context, searchedFieldName?: string, setOfParentClasses: {[key: string]: number} = {}) => {
            if (b.type !== "object")
				throw new Error("iterating over non-object: " + b.path);
				
			if (setOfParentClasses[b.path])
				throw new Error("cyclic iterating for " + b.path);
			setOfParentClasses[b.path] = 1;
            // not putting it into context, logs will be to long
            let searchFieldPrefix = searchedFieldName ? "searching "+searchedFieldName+": " : "";

            if (content.___toload) {
                context.log(searchFieldPrefix+`need to load object ${b.path} from file ${content.___toload.elem}`)
                const filename = await content.___toload.resolve(context.sub("L  ")); //root, v, "___toload", loader, trace, false, nextident);
                context.log(searchFieldPrefix+"LOADING: "+filename)
                const loaded = await loader(context, filename);
                // TODO: more universal way to meet loaded content (for example, it can be an array instead of an object)
                Object.keys(loaded).forEach(k => b.bubblizeChild(k, loaded[k]));
                delete content.___toload;
            }

            if (!searchedFieldName)
                context.log(searchFieldPrefix + `iterating and returning all fields of ${b.path}`);

            let alreadyReturnedFieldNames : {[key: string]: number} = { inherits: 1 }; // never return inherits
            const markAsReturning_and_checkIfAlreadyReturned = 
                (f: string) => (alreadyReturnedFieldNames[f] = (alreadyReturnedFieldNames[f] || 0) + 1) > 1;

            // first we iterate/return fields from this object            
            let fields = Object.keys(b.content); 
            // when fields of this object are passed, we resolve inherits one by one
            let inherits = 'inherits' in b.content ? [...b.content.inherits.content] : [];
            context.log('inherits = ', inherits);
            // contains active inherit which is not yet fully iterated
            let resolvedInherit : FieldsIterator | undefined = undefined;

            return {
                owner: b, // bubble of iterator
                next: async (c2) => {
                    while (true) {
                        if (fields.length > 0) {
                            const fname = fields.shift()!;
                            if (searchedFieldName && fname !== searchedFieldName)
                                continue;
                            if (markAsReturning_and_checkIfAlreadyReturned(fname/*, b*/))
                                continue;
                            return { field: fname, parent: b };
                        }
                        if (resolvedInherit) {
                            const f = await resolvedInherit.next(context);
                            if (f === undefined) {
                                // context.log(searchFieldPrefix+"iter end of "+resolvedInherit.owner.path)
                                resolvedInherit = undefined;
                                continue;
                            }
                            if (searchedFieldName && f.field !== searchedFieldName)
                                continue;
                            if (markAsReturning_and_checkIfAlreadyReturned(f.field))
                                continue;
                            return { field: f.field, parent: f.parent };
                        } 
                        if (inherits.length > 0) {
                            let pathObj = inherits.shift();
                            context.log(searchFieldPrefix+`iterating through parentclass ${pathObj.content} of ${b.path}`);
                            let path = await pathObj.resolve(context.sub("  "));
                            let targetElement = await b.accessChain(context.sub("> "), path);
                            // await targetElement.resolve(context);
							// if (targetElement.resolving)
							// 	throw new Error();
                            resolvedInherit = await targetElement.fieldsIterator(context, searchedFieldName, setOfParentClasses);
                            continue;
                        }
                        context.log(searchFieldPrefix+ "iteration over "+b.path+" finished")
                        return undefined;
                    }
                }
            }
        },
        parent,
        path: parent ? parent.path + "/" + name : "~",
        type: BubbleType(content),
        resolving: false,
        resolve: async (context = makeBaseContext(true)/*, realparent*/) => {
            // this ifs to decrease logging and increase speed
            if (b.resolved !== undefined) {
                return b.resolved;
            }
            if (b.type === "primitive" || (b.type === "string" && !b.content.includes("{{")))
                return b.content;

            // this is very important step to avoid 
            // - inherits of parents
            // - objects which resolving depends on own resolving
            if (b.resolving)
                throw new Error("already resolving "+b.path);

            // do not return
            b.resolving = true;
            try {
                context.log(`resolving ${b.type} ${b.path} ${b.type === "string" ? "~= "+b.content : ""}`)
                if (b.type === "object") {
                    const res : {[key: string]: any} = {};
                    const iter = await b.fieldsIterator(context.sub("|  "));
                    let next; // string ? /// { field: "fname", parent: bubble }
                    while (next = await iter.next(context.sub("|  "))) {
                        if (next.field.startsWith("__"))
                            continue;
                        context.log(`|- resolving field ${next.field} of ${b.type} ${b.path}`)
                        const f = await b.childBubble(context.sub("|a "), next.field);
                        res[next.field] = await f.resolve(context.sub("|r "));
                    }
                    context.log(`resolved ${b.type} ${b.path} to {`+Object.keys(res)+"}")
                    b.resolved = res;
                } else if (b.type === "array") {
                    const res = [];
                    for (const el of b.content)
                        res.push(await el.resolve(context.sub(".")));
                    context.log(`resolved  ${b.type} ${b.path}`)
                    b.resolved = res;
                } else if (b.type === "string") {
                    let v = b.content;
                    while (true) {
                        const path = (v.match(/\{\{([^{}]+)\}\}/) || [])[1];
                        if (!path) 
                            break;
                        let content = await b.accessChain(context.sub("|a "), path)
                        let str = await content.resolve(context.sub("|r "));
                        v = v.replace(`{{${path}}}`, str)
                    }
                       context.log(`resolved ${b.type} ${b.path}: ${v}`)
                    b.resolved = v;
                }
                //  else // primitive type
                //     b.resolved = b.content;
            } finally {
                b.resolving = false;
            }

            return b.resolved;
        } 
    }
    // root is root of root
    if (root === content)
        root = b;

    // if elem is object then tweak it a bit
    if (b.type === "object") {
        // also fix inherits weak typing
        if (content.inherits && typeof content.inherits === "string")
            content.inherits = [content.inherits];

        // fix null contents
        Object.keys(content).forEach(k => content[k] = content[k] === null ? {} : content[k])
    }

    // our bubble finished, but we need to
    // recursively bubblize all child nodes
    if (b.type === "object") 
        Object.keys(content).forEach(k => b.bubblizeChild(k, content[k]));
    else if (b.type === "array") 
        content.forEach((_ : any, k : any) => b.bubblizeChild(k, content[k]));

    return b;
}

const loader = async (
    path: string = '',
    context: LoggingContext = makeBaseContext(),
    filename: string
) => {
    const filepath = joinPathes(path, filename);
    const file = await promisify(fs.readFile)(filepath);
    return yaml.parse(file.toString(), {prettyErrors: true});
};

export default async function resolve(
    path: string,
    root: string | any
) {
    if (typeof root === 'string')
        root = await loader(path, undefined, root);
    
    return bubble(root, loader.bind(null, path));
};

// async function main() {
//     const b = bubble(yaml, loader);
//     console.log(await b.elem.result.resolve(makeBaseContext()));
// }

// main();