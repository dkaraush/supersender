import * as http from 'http';
import {parse as parseQueryString} from 'querystring';

import {stripAnsi} from './utils';
import ConfigManager from './config/manager';
import {drivers} from './drivers/.';

import * as Ansi2HtmlConverter from 'ansi-to-html';
const converter = new Ansi2HtmlConverter();
const ansi2html = converter.toHtml.bind(converter);

const forbidGET = false;

(async function () {
    const config = await ConfigManager.init();

    async function execute(token: string, action: string, req: any) {
        let configResult : any;
        configResult = await config.execute(token, action, req);

        if (typeof configResult.driver !== 'string')
            throw 'config request didn\'t respond with driver name';

        if (!drivers.has(configResult.driver))
            throw `driver with name '${configResult.driver}' wasn't found`;
        
        const driver = drivers.get(configResult.driver);
        return await driver.run(configResult);
    }

    http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
        // Example request:
        // GET /if-dev-784gfvgcd8f83y8/hello-world?username=Vasya
        // POST /if-dev-784gfvgcd8f83y8/hello-world
        //  username=Vasya

        const RequestError = (statusCode, data? : string) => {
            console.error(statusCode, data);
            res.statusCode = statusCode;
            if (data) {
                if (req.headers.accept && req.headers.accept.split(',').includes('text/html')) {
                    res.setHeader("Content-Type", "text/html");
                    data = '<head><meta charset="utf-8" /></head><body style="background: #000; color: #FFF"><pre>' + ansi2html(data) + '</pre></body>';
                } else
                    data = stripAnsi(data);
                res.write(data);
            }
            res.end();
        }

        if (req.method !== 'POST' && (forbidGET && req.method !== 'GET'))
            return RequestError(400);

        let url = req.url;
        let query = {}, queryString = '', queryIndex;
        if ((queryIndex = url.indexOf('?')) >= 0) {
            queryString = url.substring(queryIndex + 1);
            query = parseQueryString(queryString);
            url = url.substring(0, queryIndex);
        }

        let dirs = url.split('/');
        if (dirs[0].length === 0) // first slash
            dirs.splice(0, 1);
        
        if (dirs.length !== 2)
            return RequestError(400);

        const token = dirs[0];
        const action = dirs[1];
        execute(token, action, query)
            .then(result => {
                res.statusCode = 200;
                if (result !== undefined)
                    res.write(result)
                res.end();
            })
            .catch(e => {
                RequestError(500, e.stack || e.toString());
            })
    }).listen(80);
})();