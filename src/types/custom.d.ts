
import * as winston from "winston";
import Endpoints from "../lib/Endpoints";
import Counters from "../lib/Counters";

declare global {

    namespace NodeJS {
        interface Global {
            logger:  winston.Logger,
            endpoints: Endpoints,
            counters:  Counters
        }
    }

}