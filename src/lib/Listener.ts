
// includes
import { v4 as uuid } from "uuid";
import * as fs from "fs";
import * as util from "util";
import * as http from "http";
import * as https from "https";
import * as httpProxy from "http-proxy";
import Endpoints from "./Endpoints";
import Endpoint, { EndpointRoute } from "./Endpoint";

// promisify
const readFileAsync = util.promisify(fs.readFile);

// create the HTTP proxy (singleton)
const proxyOptions = {
    agent: global.agent,
    selfHandleResponse: true
};
const proxy = httpProxy.createProxyServer(proxyOptions);

// manually handle outgoing incase it returned a 500
const web_outgoing = Object.values(require("http-proxy/lib/http-proxy/passes/web-outgoing"));
proxy.on("proxyRes", (proxyRes, req, res) => {

    // define a function that can handle a response
    const respond = () => {
        for (let i = 0; i < web_outgoing.length; i++) {
            const pass: any = web_outgoing[i];
            if (pass(req, res, proxyRes, proxyOptions)) { break; }
        }
        proxyRes.pipe(res);
    }

    // respond to raise server errors
    if (res.listenerCount("waf-response") > 0) {
        res.emit("waf-response", proxyRes.statusCode);
    } else if (proxyRes.statusCode && proxyRes.statusCode < 500) {
        respond();
    } else if (res.listenerCount("http-server-error") > 0) {
        res.emit("downgrade", new Error(`HTTP status code ${proxyRes.statusCode}`));
        res.emit("http-server-error");
    } else {
        res.emit("downgrade", new Error(`HTTP status code ${proxyRes.statusCode}`));
        respond();
    }

});

// listener as a JSON object
export interface ListenerJSON {
    port:  number,
    cert?: string,
    key?:  string
}

export default class Listener {

    public port:      number;
    public protocol:  string;
    public certPath?: string;
    public keyPath?:  string;
    public cert?:     string;
    public key?:      string;
    public server?:   http.Server | https.Server;

    private proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, endpoints: Endpoints, cid: string, protocol: string, incoming: EndpointRoute) {

        // if there are no more routes, stop
        const endpoint = endpoints.shift();
        if (!endpoint) {
            global.logger.error(`[${cid}] all routes were exhausted, none were successful.`);
            res.statusCode = 503;
            res.end();
            return;
        }

        // make sure the endpoint has an "out" route
        if (!endpoint.out) {
            global.logger.log("verbose", `[${cid}] the next endpoint was not suitable because it lacked an out route...`);
            this.proxyRequest(req, res, endpoints, cid, protocol, incoming);
            return;
        }

        // make sure service endpoints have an "in" route
        if (endpoint.type === "service" && !endpoint.in) {
            global.logger.log("verbose", `[${cid}] the next endpoint was not suitable because it lacked an in route...`);
            this.proxyRequest(req, res, endpoints, cid, protocol, incoming);
            return;
        }

        // log the choice
        if (endpoint.type === "waf") {
            global.logger.log("verbose", `[${cid}] WAF (out: "${endpoint.out.href}") protection was chosen...`);
        } else if (global.BALANCE_METHOD === "load") {
            const active = global.counters.active(endpoint.out.host);
            global.logger.log("verbose", `[${cid}] route (out: "${endpoint.out.href}", status: "${endpoint.status}", active: "${active}") was chosen...`);
        } else if (global.BALANCE_METHOD === "weight") {
            global.logger.log("verbose", `[${cid}] route (out: "${endpoint.out.href}", status: "${endpoint.status}", counter: "${endpoint.counter}", weight: "${endpoint.weight}") was chosen...`);
        }
    
        // rewrite the URL
        const destination = `${protocol}://${endpoint.out.host}`;
        req.url = (endpoint.in) ?
            incoming.transform(endpoint.in, endpoint.out) + incoming.search :
            `/${incoming.hostname}${incoming.pathname}${incoming.search}`;
        global.logger.log("verbose", `[${cid}] the URL was rewritten to "${destination}${req.url}"...`);

        // increment the counters
        endpoint.last = new Date();
        endpoint.counter++;
        if (endpoint.counter > 100000) endpoint.resetPeerCounters();
        global.counters.open(endpoint.out.host);

        // decrement the counters
        req.once("close", () => {
            if (endpoint.out) global.counters.close(endpoint.out.host);
        });

        // define a function to handle the WAF response (if this is a WAF call)
        if (endpoint.type === "waf") {
            res.once("waf-response", statusCode => {
                if (statusCode === 200) {
                    global.logger.log("verbose", `[${cid}] the WAF found no vulnerabilities; the request will be proxied...`);
                    this.proxyRequest(req, res, endpoints, cid, protocol, incoming);
                } else {
                    global.logger.log("verbose", `[${cid}] the WAF did not clear the request (HTTP status code: ${statusCode}); a 403 was sent denying the request...`);
                    res.statusCode = 403;
                    res.end();
                }
            });
        }

        // define a function to downgrade the endpoint
        res.once("downgrade", (error: Error) => {
            if (endpoint.status === "up") {
                endpoint.status = "unknown";
                global.logger.log("verbose", `[${cid}] the response failed with ${error}, endpoint status downgraded to "unknown"...`);
            } else {
                global.logger.log("verbose", `[${cid}] the response failed with ${error}...`);
            }
        });

        // handle server errors, like 500, provided there is the possibility of another endpoint
        if (endpoints.length > 0) {
            res.once("http-server-error", () => {
                this.proxyRequest(req, res, endpoints, cid, protocol, incoming);
            });
        }

        // try to proxy the request
        proxy.web(req, res, {
            target: destination
        }, error => {
            res.emit("downgrade", error);
            this.proxyRequest(req, res, endpoints, cid, protocol, incoming);
        });

    }

    private proxyPort(req: http.IncomingMessage, res: http.ServerResponse, protocol: string) {
        const cid = uuid();

        // identify the host
        let host = req.headers.host;
        const forwardedHost = req.headers["X-Forwarded-Host"];
        if (Array.isArray(forwardedHost)) {
            host = forwardedHost[0];
        } else if (forwardedHost) {
            host = forwardedHost;
        }
        if (!host) {
            global.logger.log("verbose", `[${cid}] no host was provided => 404.`);
            res.statusCode = 404;
            res.end();
            return;
        }

        // identify the incoming route
        const incoming = EndpointRoute.explicit(`${protocol}://${host}${req.url || "/"}`);
        global.logger.log("verbose", `[${cid}] incoming request for "${incoming.href}"...`);

        // find all routes (up, down, unknown)
        const all = global.endpoints.findRoutes(incoming);

        // filter routes based on what is allowed
        const filtered = new Endpoints();
        for (const endpoint of all) {
            if (endpoint.status === "up" && global.INCLUDE_UP) {
                filtered.push(endpoint);
            } else if (endpoint.status === "unknown" && global.INCLUDE_UNKNOWN) {
                filtered.push(endpoint);
            } else if (endpoint.status === "down" && global.INCLUDE_DOWN) {
                filtered.push(endpoint);
            }
        }

        // see if there are available routes
        if (filtered.length < 1) {
            global.logger.log("verbose", `[${cid}] no matching routes were found => 404.`);
            res.statusCode = 404;
            res.end();
            return;
        }
        global.logger.log("verbose", `[${cid}] ${all.length} matching routes were found...`);

        // order the routes by preference
        switch (global.BALANCE_METHOD) {
            case "rr":
                filtered.sortByLast();
                break;
            case "load":
                filtered.sortByLoad();
                break;
            case "weight":
                filtered.sortByWeight();
                break;
        }

        // trim to the number of attempts
        if (filtered.length > global.ATTEMPTS) filtered.length = global.ATTEMPTS;

        // insert additional steps if required
        const comprehensive = new Endpoints();
        for (const endpoint of filtered) {
            if (endpoint.waf === "protect") {
                const found = comprehensive.find(e => e.type === "waf");
                if (!found) comprehensive.push( Endpoint.createProtectEndpoint() );
            }
            comprehensive.push(endpoint);
        }

        // try until successful or the the number of attempts is exhausted
        this.proxyRequest(req, res, comprehensive, cid, protocol, incoming);

    }

    public async open() {
        if (this.protocol === "http") {

            // create http server
            this.server = http.createServer((req, res) => {
                this.proxyPort(req, res, this.protocol);
            });
            this.server.listen(this.port);

        } else if (this.protocol === "https" && this.certPath && this.keyPath) {

            // read the cert and key
            this.cert = await readFileAsync(this.certPath, "utf8");
            this.key = await readFileAsync(this.keyPath, "utf8");

            // create https server
            this.server = https.createServer({
                cert: this.cert,
                key: this.key
            }, (req, res) => {
                this.proxyPort(req, res, this.protocol);
            });
            this.server.listen(this.port);

        }
    }

    public async close() {
        throw new Error("need to implement a graceful transition");
    }

    constructor(obj: ListenerJSON) {
        this.port = obj.port;
        this.protocol = (obj.cert && obj.key) ? "https" : "http";
        if (obj.cert) this.certPath = obj.cert;
        if (obj.key) this.keyPath = obj.key;
    }

}