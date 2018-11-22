import * as http from "http";
import * as https from "https";
import { URL } from "url";

import { Logger, loggerFactory } from "@zxteam/logger";

export class WebError extends Error {
	public readonly statusCode: number;
	public readonly statusDescription: string;
	public readonly errorData: string;
	constructor(statusCode: number, statusDescription: string, data: string) {
		super(`${statusCode} ${statusDescription}`);
		this.statusCode = statusCode;
		this.statusDescription = statusDescription;
		this.errorData = data;
	}
}
export type ProxyOpts = HttpProxyOpts | Socks5ProxyOpts;
export interface HttpProxyOpts {
	type: "http";
	host: string;
	port: number;
}
export interface Socks5ProxyOpts {
	type: "socks5";
}
export type SslOpts = SslCertOpts | SslPfxOpts;
export interface SslCertOpts {
	key: Buffer;
	cert: Buffer;
	ca?: Buffer;
}
export interface SslPfxOpts {
	pfx: Buffer;
	passphrase: string;
}
export interface WebClientInvokeData {
	url: URL;
	method: "CONNECT" | "DELETE" | "HEAD" | "GET" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE" | string;
	headers?: http.OutgoingHttpHeaders;
	body?: Buffer;
}
export interface WebClientLike {
	invoke(data: WebClientInvokeData): Promise<Buffer>;
}
export class WebClient implements WebClientLike {
	private readonly _proxyOpts: ProxyOpts | null;
	private readonly _sslOpts: SslOpts | null;
	private _log: Logger;
	public constructor(opts?: WebClient.Opts) {
		this._proxyOpts = opts && opts.proxyOpts || null;
		this._sslOpts = opts && opts.sslOpts || null;
	}

	public get log() { return this._log || (this._log = loggerFactory.getLogger(this.constructor.name)); }
	public set log(value: Logger) { this._log = value; }

	public invoke({ url, method, headers, body }: WebClientInvokeData): Promise<Buffer> {
		if (this.log.isTraceEnabled()) { this.log.trace("begin invoke(...)", url, method, headers, body); }
		return new Promise<Buffer>((resolve, reject) => {
			const responseHandler = (response: http.IncomingMessage) => {
				const responseDataChunks: Array<Buffer> = [];
				response.on("data", (chunk: Buffer) => responseDataChunks.push(chunk));
				response.on("error", error => reject(error));
				response.on("end", () => {
					const finalData = Buffer.concat(responseDataChunks);
					if (response.statusCode === 200) {
						return resolve(finalData);
					} else {
						return reject(
							new WebError(
								response.statusCode || 0,
								response.statusMessage || "",
								finalData.toString()
							)
						);
					}
				});
			};
			const proxyOpts = this._proxyOpts;
			if (proxyOpts && proxyOpts.type === "http") {
				const reqOpts = {
					protocol: "http:",
					host: proxyOpts.host,
					port: proxyOpts.port,
					path: url.href,
					method,
					headers: Object.assign({ Host: url.host }, headers)
				};
				if (this.log.isTraceEnabled()) { this.log.trace("call http.request", reqOpts); }
				const request = http.request(reqOpts, responseHandler)
					.on("error", error => {
						this.log.debug("http.request failed", error);
						reject(error);
					});
				if (body) {
					if (this.log.isTraceEnabled()) { this.log.trace("write body", body.toString()); }
					request.write(body);
				}
				request.end();
			} else {
				const reqOpts: https.RequestOptions = {
					protocol: url.protocol,
					host: url.hostname,
					port: url.port,
					path: url.pathname + url.search,
					method: method,
					headers: headers
				};
				if (reqOpts.protocol === "https:") {
					const sslOpts = this._sslOpts;
					if (sslOpts) {
						if ("pfx" in sslOpts) {
							reqOpts.pfx = sslOpts.pfx;
							reqOpts.passphrase = sslOpts.passphrase;
						} else {
							reqOpts.key = sslOpts.key;
							reqOpts.cert = sslOpts.cert;
							if (sslOpts.ca) {
								reqOpts.ca = sslOpts.ca;
							}
						}
					}
					if (this.log.isTraceEnabled()) { this.log.trace("call https.request", reqOpts); }
					const request = https.request(reqOpts, responseHandler)
						.on("error", error => {
							this.log.debug("https.request failed", error);
							reject(error);
						});
					if (body) {
						if (this.log.isTraceEnabled()) { this.log.trace("write body", body.toString()); }
						request.write(body);
					}
					request.end();
				} else {
					if (this.log.isTraceEnabled()) { this.log.trace("call http.request", reqOpts); }
					const request = http.request(reqOpts, responseHandler)
						.on("error", error => {
							this.log.debug("http.request failed", error);
							reject(error);
						});
					if (body) {
						if (this.log.isTraceEnabled()) { this.log.trace("write body", body.toString()); }
						request.write(body);
					}
					request.end();
				}
			}
		});
	}
}
export namespace WebClient {
	export interface Opts {
		proxyOpts?: ProxyOpts;
		sslOpts?: SslOpts;
	}
}

export default WebClient;
