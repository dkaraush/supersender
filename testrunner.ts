import * as fs from 'fs';

import { red, green, grey, bold } from 'kleur';
import equal from 'deep-equal';
import resolve, { makeBaseContext } from './engine';

const testsFolder = __dirname + "/tests/";
const isDir = (filename: string) => fs.statSync(testsFolder + filename).isDirectory();

const puts = (...s: string[]) => process.stdout.write(s.join(' '));
const removeLastLine = () => process.stdout.write('\r\x1b[K');

(async function () {
    const files = fs.readdirSync(testsFolder);
    for (const file of files) {
        const dir = isDir(file);
        const path = testsFolder + (dir ? file : '');
        const filename = dir ? 'index.yaml' : file;
        
        const bubble = await resolve(path, filename);
        
        const expected = await bubble.content.expected.resolve();
        
        const log = (status?: boolean, reason: string = '') => {
            const statuses : any = {
                'false': red('⨉'),
                'true': green('✓')
            };
            removeLastLine();
            puts(statuses[status + ""], file, grey(reason));
        }

        puts('\n' + grey('☃'), file, grey('loading...'));

        try {
            const actual = await bubble.content.result.resolve();
            log(equal(actual, expected, { strict: true }), JSON.stringify(actual) + ' === ' + JSON.stringify(expected));
        } catch (e) {
            log(expected === 'error', 'not expected an error');
            if (expected !== 'error')
                throw e;
        }
    }

    puts('\n');
})();