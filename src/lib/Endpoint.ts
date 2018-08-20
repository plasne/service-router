
import { v4 as uuid } from "uuid";
import objhash = require("object-hash");
import { URL } from "url";

export type EndpointStatus = "unknown" | "up" | "down" | "off";
export type EndpointType = "waf" | "service";
type EndpointProtocol = "http" | "https" | "*";
type EndpointPort = number | "*";

export interface EndpointJSON {
    method?:   string,
    in?:       string,
    out:       string,
    probe?:    string,
    weight?:   number,
    waf?:      string
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

    public get weight(): number {
        const parent = _parent.get(this) as Endpoint;
        return parent.weight;
    }
    public set weight(value: number) {
        const parent = _parent.get(this) as Endpoint;
        parent.weight = value;
    }

    public get waf(): string {
        const parent = _parent.get(this) as Endpoint;
        return parent.waf;
    }
    public set waf(value: string) {
        const parent = _parent.get(this) as Endpoint;
        parent.waf = value;
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

interface EndpointRouteJSON {
    protocol: EndpointProtocol;
    port:     EndpointPort;
    host:     string;
    hostname: string;
    pathname: string;
    search:   string;
    href:     string;
}

export class EndpointRoute {
    public protocol: EndpointProtocol;
    public port:     EndpointPort;
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

    private static normalizeProtocol(route: URL): EndpointProtocol {
        switch (route.protocol) {
            case "https:": return "https";
            case "http:": return "http";
            default:
                throw new Error(`ROUTE ${route.href}: must specify a protocol of "http" or "https".`);
        }
    }

    protected static normalizePort(route: URL): EndpointPort {
        if (route.port) {
            return Number.parseInt(route.port);
        } else if (route.protocol === "http:") {
            return 80;
        } else if (route.protocol === "https:") {
            return 443;
        } else {
            throw new Error(`ROUTE ${route.href}: must specify a port.`);
        }
    }

    public static route(href: string) {
        href = href.toLowerCase();
        let hasProtocol = true;
        if (!href.startsWith("http:") && !href.startsWith("https:")) {
            href = "http://" + href;
            hasProtocol = false;
        }
        let hasPort = true;
        const slash = href.split("/");
        if (slash.length > 2) {
            const colon = slash[2].split(":");
            if (colon.length === 2 && colon[1] === "*") {
                slash[2] = colon[0] + ":0";
                href = slash.join("/");
                hasPort = false;
            }
        }
        const route = new URL(href);
        if (!route.host || !route.hostname) throw new Error(`ROUTE ${href}: must specify a valid host/hostname.`);
        const obj: EndpointRouteJSON = {
            protocol: (hasProtocol) ? EndpointRoute.normalizeProtocol(route) : "*",
            port: (hasPort) ? EndpointRoute.normalizePort(route) : "*",
            host: route.host.toLowerCase(),
            hostname: route.hostname.toLowerCase(),
            pathname: (route.pathname) ? route.pathname.toLowerCase() : "/",
            search: route.search || "",
            href: route.href || href
        };
        return new EndpointRoute(obj);
    }

    public static explicit(href: string) {
        const route = new URL(href);
        if (!route.host || !route.hostname) throw new Error(`ROUTE ${href}: must specify a valid host/hostname.`);
        const obj: EndpointRouteJSON = {
            protocol: EndpointRoute.normalizeProtocol(route),
            port: EndpointRoute.normalizePort(route),
            host: route.host.toLowerCase(),
            hostname: route.hostname.toLowerCase(),
            pathname: (route.pathname) ? route.pathname.toLowerCase() : "/",
            search: route.search || "",
            href: route.href || href
        };
        return new EndpointRoute(obj);
    }

    constructor(obj: EndpointRouteJSON) {
        this.protocol = obj.protocol;
        this.port = obj.port;
        this.host = obj.host;
        this.hostname = obj.hostname;
        this.pathname = obj.pathname;
        this.search = obj.search;
        this.href = obj.href;
    }
}

export default class Endpoint {

    public id:      string;
    public hash:    string;
    public type:    EndpointType   = "service";
    public method:  string         = "GET";
    public in?:     EndpointRoute;
    public out?:    EndpointRoute;
    public probe?:  EndpointRoute;
    public weight:  number         = 1.0;
    public waf:     string         = "bypass";
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
        if (this.probe && this.probe.href) {
            clone.url = this.probe.href;
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

    public static createProtectEndpoint() {
        const endpoint = new Endpoint({
            out: "http://localhost:9002"
        });
        endpoint.type = "waf";
        return endpoint;
    }

    constructor(obj: EndpointJSON) {

        // assign a unique id
        this.id = uuid();

        // hash the definition so that we can determine if it changes
        this.hash = objhash(obj);

        // if there is an "in" route, then define it
        if (obj.in) {
            try {
                this.in = EndpointRoute.route(obj.in);
            } catch (ex) {
                global.logger.error(ex);
            }
        }

        // define the "out" route
        this.out = EndpointRoute.explicit(obj.out);

        // if there is an "health" route, then define it
        if (obj.probe) {
            try {
                this.probe = EndpointRoute.explicit(obj.probe);
            } catch (ex) {
                global.logger.error(ex);
            }
        }

        // assign other values
        if (obj.method) this.method = obj.method;
        if (obj.weight) this.weight = obj.weight;
        if (obj.waf) this.waf = obj.waf;

        // create the proxy
        this.proxy = new EndpointProxy(this);

    }
}
