
import { v4 as uuid } from "uuid";
import * as url from "url";
import objhash = require("object-hash");

export type EndpointStatus = "unknown" | "up" | "down" | "off";

export interface EndpointJSON {
    method?:   string,
    in?:       string,
    out:       string,
    health?:   string,
    weight?:   number
}

const _parent = new WeakMap();
const _bag = new WeakMap();

export class EndpointProxy {

    public get id(): string {
        const parent = _parent.get(this) as Endpoint;
        return parent.id;
    }
    public set id(_: string) {
        throw new Error(`ENDPOINT "${this.out}": setting the id is not supported.`);
    }

    public get method(): string {
        const parent = _parent.get(this) as Endpoint;
        return parent.method;
    }
    public set method(value: string) {
        const parent = _parent.get(this) as Endpoint;
        parent.method = value;
    }

    public get in(): string {
        const parent = _parent.get(this) as Endpoint;
        return (parent.in) ? parent.in.href : "";
    }
    public set in(_: string) {
        throw new Error(`ENDPOINT "${this.out}": setting the in URL is not supported.`);
    }

    public get out(): string {
        const parent = _parent.get(this) as Endpoint;
        return (parent.out) ? parent.out.href : "";
    }
    public set out(_: string) {
        throw new Error(`ENDPOINT "${this.out}": setting the out URL is not supported.`);
    }

    public get status(): EndpointStatus {
        const parent = _parent.get(this) as Endpoint;
        return parent.status;
    }
    public set status(value: EndpointStatus) {
        const parent = _parent.get(this) as Endpoint;
        parent.status = value;
    }

    public get actual(): EndpointStatus {
        const parent = _parent.get(this) as Endpoint;
        return parent.actual;
    }
    public set actual(value: EndpointStatus) {
        const parent = _parent.get(this) as Endpoint;
        parent.actual = value;
    }

    public get code(): number {
        const parent = _parent.get(this) as Endpoint;
        return parent.code || 0;
    }
    public set code(_: number) {
        throw new Error(`ENDPOINT "${this.out}": setting the code is not supported.`);
    }

    public get body(): string {
        const parent = _parent.get(this) as Endpoint;
        return parent.body || "";
    }
    public set body(_: string) {
        throw new Error(`ENDPOINT "${this.out}": setting the body is not supported.`);
    }

    public get bag(): any {
        return _bag.get(this);
    }
    public set bag(_: any) {
        throw new Error(`ENDPOINT "${this.out}": setting the (property) bag is not supported.`);
    }

    constructor(parent: Endpoint) {
        _parent.set(this, parent);
        _bag.set(this, {});
    }
}

export class EndpointRoute {
    public protocol: string;
    public port:     number;
    public host:     string;
    public hostname: string;
    public pathname: string;
    public search:   string;
    public href:     string;

    public transform(from: EndpointRoute, to: EndpointRoute) {
        const trimmed = this.pathname.substring(from.pathname.length);
        const consolidated = to.pathname + trimmed;
        const dedupe = consolidated.replace(new RegExp("//", "g"), "/");
        return dedupe;
    }

    constructor(href: string) {
        const route = url.parse(href);
        if (!route.protocol) throw new Error(`ROUTE ${href}: must specify a protocol.`);
        if (route.protocol !== "http:" && route.protocol !== "https:") throw new Error(`ROUTE ${href}: must specify a protocol of "http" or "https".`);
        this.protocol = route.protocol.substring(0, route.protocol.length - 1);
        if (route.port) {
            this.port = Number.parseInt(route.port);
        } else if (route.protocol === "http:") {
            this.port = 80;
        } else if (route.protocol === "https:") {
            this.port = 443;
        } else {
            throw new Error(`ROUTE ${href}: must specify a port.`);
        }
        if (!route.host || !route.hostname) throw new Error(`ROUTE ${href}: must specify a valid host/hostname.`);
        this.host = route.host.toLowerCase();
        this.hostname = route.hostname.toLowerCase();
        this.pathname = (route.pathname) ? route.pathname.toLowerCase() : "/";
        this.search = route.search || "";
        this.href = route.href || href;
    }
}

export default class Endpoint {

    public id:      string;
    public hash:    string;
    public method:  string         = "GET";
    public in?:     EndpointRoute;
    public out?:    EndpointRoute;
    public health?: EndpointRoute;
    public weight:  number         = 1.0;
    public _status: EndpointStatus = "unknown";
    public actual:  EndpointStatus = "unknown";
    public code?:   number;
    public body?:   string;
    public last:    Date           = new Date();
    public counter: number         = 0;
    public proxy:   EndpointProxy;

    public get status(): EndpointStatus {
        return this._status;
    }
    public set status(value: EndpointStatus) {
        if (value === "up" && this._status !== "up" && this.in) {
            global.endpoints.resetCounters(this.in.host);
        }
        this._status = value;
    }

    public generateProbeOptions(options: any) {
        const clone = (options) ? Object.assign({}, options) : {
            timeout: 30000
        };
        clone.method = this.method;
        if (this.health && this.health.href) {
            clone.url = this.health.href;
        } else if (this.out && this.out.href) {
            clone.url = this.out.href;
        }
        return clone;
    }

    public stagePingResults(code: number, status: EndpointStatus, body: string) {
        this.code = code;
        this.actual = status;
        this.body = body;
    }

    public resetPeerCounters() {
        if (this.in) global.endpoints.resetCounters(this.in.host);
    }

    constructor(obj: EndpointJSON) {

        // assign a unique id
        this.id = uuid();
        global.logger.log("info", `endpoint "${this.id}" (in: "${obj.in}", out: "${obj.out}") was defined.`);

        // hash the definition so that we can determine if it changes
        this.hash = objhash(obj);

        // need to put these into a better object:

        // if there is an "in" route, then define it
        if (obj.in) {
            try {
                this.in = new EndpointRoute(obj.in);
            } catch (ex) {
                global.logger.error(ex);
            }
        }

        // define the "out" route
        this.out = new EndpointRoute(obj.out);

        // if there is an "health" route, then define it
        if (obj.health) {
            try {
                this.health = new EndpointRoute(obj.health);
            } catch (ex) {
                global.logger.error(ex);
            }
        }

        // assign other values
        if (obj.method) this.method = obj.method;
        if (obj.weight) this.weight = obj.weight;

        // create the proxy
        this.proxy = new EndpointProxy(this);

    }
}
