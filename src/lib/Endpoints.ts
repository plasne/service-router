
import * as events from "events";
import objhash = require("object-hash");
import Endpoint, { EndpointJSON, EndpointProxy, EndpointRoute } from "./Endpoint";

export default class Endpoints extends Array<Endpoint> {

    public events: events = new events.EventEmitter();

    public define(obj: EndpointJSON) {

        // if the endpoint already exists, there is no reason to do anything but return it
        const hash = objhash(obj);
        const found = this.find(existing => hash === existing.hash);
        if (found) return found;

        // create the new endpoint (must have an out)
        const endpoint = new Endpoint(obj);
        if (!endpoint) return null;

        // if it has a new port then raise that as an event
        if (endpoint.in) {
            const found = this.find(existing => {
                if (!existing.in) return false;
                if (!endpoint.in) return false;
                return (existing.in.port === endpoint.in.port);
            });
            if (!found) {
                this.events.emit("add-port", endpoint.in.protocol, endpoint.in.port);
            }
        }

        // add the new endpoint
        this.push(endpoint);
        this.events.emit("add-endpoint", endpoint);

        return endpoint;
    }

    public resolve(proxyOrProxies: EndpointProxy | EndpointProxy[]) {
        const proxies = (Array.isArray(proxyOrProxies)) ? proxyOrProxies : [proxyOrProxies];
        const endpoints = new Endpoints();
        for (const proxy of proxies) {
            const endpoint = this.find(ep => ep.id === proxy.id);
            if (endpoint) endpoints.push(endpoint);
        }
        return endpoints;
    }

    public groupByProbeOptions(options: any) {
        const groups: Endpoints[] = [];
        for (const endpoint of this) {
            const src = endpoint.generateProbeOptions(options);
            const srcJson = JSON.stringify(src);
            const found = groups.find(group => {
                const dstJson = JSON.stringify(group[0].generateProbeOptions(options));
                return (srcJson === dstJson);
            });
            if (found) {
                found.push(endpoint);
            } else {
                const group = new Endpoints();
                group.push(endpoint);
                groups.push(group);
            }
        }
        return groups;
    }

    public findRoutes(incoming: EndpointRoute) {

        // filter to everything that matches
        const valid = new Endpoints();
        let longest = 0;
        for (const endpoint of this) {
            if (!endpoint.in) {
                // this endpoint cannot accept inbound traffic
            } else if (endpoint.status === "off") {
                // the endpoint is turned off
            } else if (endpoint.in.hostname !== incoming.hostname) {
                // the hostnames don't match
            } else if (incoming.pathname < endpoint.in.pathname) {
                // the incoming path is longer than this endpoint's path
            } else if (!incoming.pathname.startsWith(endpoint.in.pathname)) {
                // the path is not equivalent
            } else {

                // include; if as long or longer
                const len = endpoint.in.pathname.length;
                if (len > longest) {
                    valid.length = 0;
                    longest = len;
                }
                if (len === longest) {
                    valid.push(endpoint);
                }

            }
        }

        return valid;
    }

    public sortByLast() {
        this.sort((a, b) => {

            // first sort by status
            if (a.status !== b.status) {
                if (a.status === "up") return -1;
                if (a.status === "down") return 1;
            }

            // next sort by last time served
            return a.last.valueOf() - b.last.valueOf();

        });
    }

    public sortByLoad() {
        this.sort((a, b) => {

            // first sort by status
            if (a.status !== b.status) {
                if (a.status === "up") return -1;
                if (a.status === "down") return 1;
            }

            // next sort by the least number of active connections
            if (a.out && b.out) {
                const ac = global.counters.active(a.out.host);
                const bc = global.counters.active(b.out.host);
                return ac - bc;
            } else if (a.out) {
                return -1;
            } else if (b.out) {
                return 1;
            } else {
                return 0;
            }

        });
    }

    public sortByWeight() {
        this.sort((a, b) => {

            // first sort by status
            if (a.status !== b.status) {
                if (a.status === "up") return -1;
                if (a.status === "down") return 1;
            }

            // next sort by weight
            return (a.counter * (1.0 - a.weight)) - (b.counter * (1.0 - b.weight));

        });
    }

    public commit() {
        for (const endpoint of this) {
            endpoint.status = endpoint.actual;
        }
    }

    // on "reset-counters", flush all endpoints that go in on that host name
    //  NOTE: this addresses a problem with sortByWeight,
    //   if an endpoint is down for a long time you don't want a long catch-up
    public resetCounters(host: string) {
        for (const endpoint of this) {
            if (endpoint.counter > 0 && endpoint.in && endpoint.in.host === host) {
                endpoint.counter = 0;
                global.logger.log("info", `endpoint "${endpoint.id}" (in.host: "${endpoint.in.host}") had its counters reset.`);
            }
        }
    }

}