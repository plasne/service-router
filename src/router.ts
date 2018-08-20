
// includes
require("dotenv").config();
import cmd = require("commander");
import agentkeepalive = require("agentkeepalive");
import * as winston from "winston";
import Probe from "./lib/Probe";
import Endpoints from "./lib/Endpoints";
import Counters from "./lib/Counters";
import Listeners from "./lib/Listeners";

// define command line parameters
cmd
    .version("0.1.0")
    .option("-l, --log-level <string>", `LOG_LEVEL. The minimum level to log to the console (error, warn, info, verbose, debug, silly). Defaults to "error".`)
    .option("-p, --port <integer>", `PORT. The port to host the web services on. Defaults to "8080".`, parseInt)
    .option("-a, --attempts <integer>", `ATTEMPTS. The number of routes to try on each connection before giving up. Defaults to "1".`, parseInt)
    .option("-i, --consider <list>", `CONSIDER. A list of status codes that will be considered for traffic. Defaults to "up,unknown,down".`)
    .option("-b, --balance-method <string>", `BALANCE_METHOD. Can be "rr" for round-robin, "load" for least-active, or "weight" to use weights. Defaults to "rr".`)
    .parse(process.argv);

// settings
global.LOG_LEVEL = (cmd.logLevel || process.env.LOG_LEVEL || "error").toLowerCase();
if (global.LOG_LEVEL !== "error" && global.LOG_LEVEL !== "warn" && global.LOG_LEVEL !== "info" && global.LOG_LEVEL !== "verbose" && global.LOG_LEVEL !== "debug" && global.LOG_LEVEL !== "silly") global.LOG_LEVEL = "error";
global.PORT = cmd.port || process.env.PORT || 8080;
global.ATTEMPTS = cmd.attempts || process.env.ATTEMPTS || 1;
if (global.ATTEMPTS < 1) global.ATTEMPTS = 1;
if (global.ATTEMPTS > 9) global.ATTEMPTS = 9;
const CONSIDER: string  = (cmd.consider || process.env.CONSIDER || "up,unknown,down").toLowerCase();
global.INCLUDE_UP = CONSIDER.includes("up") || false;
global.INCLUDE_UNKNOWN = CONSIDER.includes("unknown") || false;
global.INCLUDE_DOWN = CONSIDER.includes("down") || false;
if (!global.INCLUDE_UP && !global.INCLUDE_UNKNOWN && !global.INCLUDE_DOWN) global.INCLUDE_UP = global.INCLUDE_UNKNOWN = global.INCLUDE_DOWN = true;
global.BALANCE_METHOD = (cmd.balanceMethod || process.env.BALANCE_METHOD || "rr").toLowerCase();
if (global.BALANCE_METHOD !== "rr" && global.BALANCE_METHOD !== "load" && global.BALANCE_METHOD !== "weight") global.BALANCE_METHOD = "rr";

// globals
global.listeners = new Listeners();
global.endpoints = new Endpoints();
global.counters  = new Counters();
global.agent = new agentkeepalive();

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
    level: global.LOG_LEVEL,
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
console.log(`LOG_LEVEL = "${global.LOG_LEVEL}"`);
global.logger.log("verbose", `PORT            = "${global.PORT}"`);
global.logger.log("verbose", `ATTEMPTS        = "${global.ATTEMPTS}"`);
global.logger.log("verbose", `INCLUDE_UP      = "${global.INCLUDE_UP}"`);
global.logger.log("verbose", `INCLUDE_UNKNOWN = "${global.INCLUDE_UNKNOWN}"`);
global.logger.log("verbose", `INCLUDE_DOWN    = "${global.INCLUDE_DOWN}"`);
global.logger.log("verbose", `BALANCE_METHOD  = "${global.BALANCE_METHOD}"`);

(async () => {
    const probe = new Probe();
    await probe.load("./config/rules.js");
    probe.process();
})();
