
// includes
require("dotenv").config();
import cmd = require("commander");
import * as winston from "winston";
import agentkeepalive = require("agentkeepalive");
import { v4 as uuid } from "uuid";
import * as http from "http";
import * as httpProxy from "http-proxy";
import Probe from "./lib/Probe";
import Endpoints from "./lib/Endpoints";
import { EndpointRoute } from "./lib/Endpoint";
import Counters from "./lib/Counters";

// define command line parameters
cmd
    .version("0.1.0")
    .option("-l, --log-level <string>", `LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".`)
    .option("-p, --port <integer>", `PORT. The port to host the web services on. Defaults to "8000".`, parseInt)
    .option("-a, --attempts <integer>", `ATTEMPTS. The number of routes to try on each connection before giving up. Defaults to "1".`, parseInt)
    .option("-i, --consider <list>", `CONSIDER. A list of status codes that will be considered for traffic. Defaults to "up,unknown,down".`)
    .option("-b, --balance-method <string>", `BALANCE_METHOD. Can be "rr" for round-robin, "load" for least-active, or "weight" to use weights. Defaults to "rr".`)
    .parse(process.argv);

// locals
let   LOG_LEVEL: string  = cmd.logLevel  || process.env.LOG_LEVEL || "error";
LOG_LEVEL = LOG_LEVEL.toLowerCase();
if (LOG_LEVEL !== "error" && LOG_LEVEL !== "warn" && LOG_LEVEL !== "info" && LOG_LEVEL !== "verbose" && LOG_LEVEL !== "debug" && LOG_LEVEL !== "silly") LOG_LEVEL = "error";
const PORT:      number  = cmd.port      || process.env.PORT      || 8080;
let   ATTEMPTS:  number  = cmd.attempts  || process.env.ATTEMPTS  || 1;
if (ATTEMPTS < 1) ATTEMPTS = 1;
if (ATTEMPTS > 9) ATTEMPTS = 9;
let   CONSIDER:        string  = cmd.consider      || process.env.CONSIDER       || "up,unknown,down";
CONSIDER = CONSIDER.toLowerCase();
let   INCLUDE_UP:      boolean = CONSIDER.includes("up")      || false;
let   INCLUDE_UNKNOWN: boolean = CONSIDER.includes("unknown") || false;
let   INCLUDE_DOWN:    boolean = CONSIDER.includes("down")    || false;
if (!INCLUDE_UP && !INCLUDE_UNKNOWN && !INCLUDE_DOWN) INCLUDE_UP = INCLUDE_UNKNOWN = INCLUDE_DOWN = true;
let   BALANCE_METHOD:  string  = cmd.balanceMethod || process.env.BALANCE_METHOD || "rr";
BALANCE_METHOD = BALANCE_METHOD.toLowerCase();
if (BALANCE_METHOD !== "rr" && BALANCE_METHOD !== "load" && BALANCE_METHOD !== "weight") BALANCE_METHOD = "rr";

// globals
global.endpoints = new Endpoints();
global.counters  = new Counters();

// enable logging
const logColors: {
    [index: string]: string
} = {
    "error":   "\x1b[31m", // red
    "warn":    "\x1b[33m", // yellow
    "info":    "",         // white
    "verbose": "\x1b[32m", // green
    "debug":   "\x1b[32m", // green
    "silly":   "\x1b[32m"  // green
};
global.logger = winston.createLogger({
    level: LOG_LEVEL,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(event => {
                    const color = logColors[event.level] || "";
                    const level = event.level.padStart(7);
                    return `${event.timestamp} ${color}${level}\x1b[0m: ${event.message}`;
                })
            )
        })
    ]
});

// log startup
console.log(`LOG_LEVEL = "${LOG_LEVEL}"`);
global.logger.log("verbose", `PORT = "${PORT}"`);
global.logger.log("verbose", `ATTEMPTS = "${ATTEMPTS}"`);
global.logger.log("verbose", `INCLUDE_UP = "${INCLUDE_UP}"`);
global.logger.log("verbose", `INCLUDE_UNKNOWN = "${INCLUDE_UNKNOWN}"`);
global.logger.log("verbose", `INCLUDE_DOWN = "${INCLUDE_DOWN}"`);
global.logger.log("verbose", `BALANCE_METHOD = "${BALANCE_METHOD}"`);

// create the HTTP proxy
const agent = new agentkeepalive();
const proxyOptions = {
    agent: agent,
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
    if (proxyRes.statusCode && proxyRes.statusCode < 500) {
        respond();
    } else if (res.listenerCount("http-server-error") > 0) {
        res.emit("downgrade", new Error(`HTTP status code ${proxyRes.statusCode}`));
        res.emit("http-server-error");
    } else {
        res.emit("downgrade", new Error(`HTTP status code ${proxyRes.statusCode}`));
        respond();
    }

});

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, endpoints: Endpoints, cid: string, protocol: string, incoming: EndpointRoute) {

    // if there are no more routes, stop
    const endpoint = endpoints.shift();
    if (!endpoint) {
        global.logger.error(`[${cid}] all routes were exhausted, none were successful.`);
        res.statusCode = 503;
        res.end();
        return;
    }

    // make sure the endpoint has in/out routes
    if (!endpoint.in || !endpoint.out) {
        global.logger.log("verbose", `[${cid}] the next endpoint was not suitable because it lacked both an in and out route...`);
        proxyRequest(req, res, endpoints, cid, protocol, incoming);
        return;
    }

    // log the choice
    global.logger.log("verbose", `[${cid}] route (out: "${endpoint.out.href}", status: "${endpoint.status}", counter: "${endpoint.counter}", weight: "${endpoint.weight}") was chosen...`);
    
    // rewrite the URL
    const destination = `${protocol}://${endpoint.out.host}`;
    req.url = incoming.transform(endpoint.in, endpoint.out) + incoming.search;
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
            proxyRequest(req, res, endpoints, cid, protocol, incoming);
        });
    }

    // try to proxy the request
    proxy.web(req, res, {
        target: destination
    }, error => {
        res.emit("downgrade", error);
        proxyRequest(req, res, endpoints, cid, protocol, incoming);
    });

}

function proxyPort(req: http.IncomingMessage, res: http.ServerResponse, protocol: string) {
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
    const incoming = new EndpointRoute(`${protocol}://${host}${req.url || "/"}`);
    global.logger.log("verbose", `[${cid}] incoming request for "${incoming.href}"...`);

    // find all routes (up, down, unknown)
    const all = global.endpoints.findRoutes(incoming);

    // filter routes based on what is allowed
    const filtered = new Endpoints();
    for (const endpoint of all) {
        if (endpoint.status === "up" && INCLUDE_UP) {
            filtered.push(endpoint);
        } else if (endpoint.status === "unknown" && INCLUDE_UNKNOWN) {
            filtered.push(endpoint);
        } else if (endpoint.status === "down" && INCLUDE_DOWN) {
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
    switch (BALANCE_METHOD) {
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
    if (filtered.length > ATTEMPTS) filtered.length = ATTEMPTS;

    // try until successful or the the number of attempts is exhausted
    proxyRequest(req, res, filtered, cid, protocol, incoming);

}

// listen for new ports
global.endpoints.events.on("add-port", (protocol: string, port: number) => {

    if (protocol === "http") {
        const server = http.createServer((req, res) => {
            proxyPort(req, res, protocol);
        });
        server.listen(port);
        global.logger.log("info", `proxying on port ${port}...`);
    }

        //if (req.headers.dest === "1") target = "http://localhost:8100";
        //if (req.headers.dest === "2") target = "http://localhost:8101";
        //proxy.web(req, res, {
            //target: target
        //}, error => {
            //res.statusCode = 500;
            //res.end();
            //console.log(JSON.stringify(error));
            //proxy.web(req, res, {
                //target: "http://localhost:8101"
            //});
        //});

});

(async () => {
    const probe = new Probe();
    await probe.load("./config/rules.js");
    probe.process();
})();
