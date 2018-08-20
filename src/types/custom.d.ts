
import * as winston from "winston";
import agentkeepalive = require("agentkeepalive");
import Endpoints from "../lib/Endpoints";
import Counters from "../lib/Counters";
import Listeners from "../lib/Listeners";

declare global {

    namespace NodeJS {
        interface Global {
            logger:          winston.Logger,
            listeners:       Listeners,
            endpoints:       Endpoints,
            counters:        Counters,
            agent:           agentkeepalive,
            LOG_LEVEL:       "error" | "warn" | "info" | "verbose" | "debug" | "silly" | "error",
            PORT:            number,
            ATTEMPTS:        number,
            INCLUDE_UP:      boolean,
            INCLUDE_UNKNOWN: boolean,
            INCLUDE_DOWN:    boolean,
            BALANCE_METHOD:  "rr" | "load" | "weight",
        }
    }

}
