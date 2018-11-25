import * as http from "http";
import * as querystring from "querystring";
import { URL } from "url";
import LimitFactory, { Limit, LimitToken } from "limit.js";
import { DisposableLike } from "@zxteam/contract";
import { loggerFactory, Logger } from "@zxteam/logger";

import { WebClient, WebClientLike } from "./WebClient";

export namespace WebApiClient {
	export interface Opts {
		url: string;
		limit?: {
			opts: Limit.Opts;
			timeout: number;
		};
		webClient?: WebClient.Opts | WebClientLike;
	}
}
export class WebApiClient implements DisposableLike {
	private static _webClientFactory?: (opts?: WebClient.Opts) => WebClientLike;
	private readonly _baseUrl: URL;
	private readonly _webClient: WebClientLike;
	private readonly _limit?: { instance: Limit, timeout: number };
	private _log: Logger | null;

	public constructor(opts: WebApiClient.Opts) {
		this._baseUrl = new URL(opts.url);
		if (opts.limit) {
			this._limit = {
				instance: LimitFactory(opts.limit.opts),
				timeout: opts.limit.timeout
			};
		}
		this._log = null;
		if (opts.webClient && "invoke" in opts.webClient) {
			this._webClient = opts.webClient;
		} else if (WebApiClient._webClientFactory) {
			this._webClient = WebApiClient._webClientFactory(opts.webClient);
		} else {
			this._webClient = new WebClient(opts.webClient);
		}
	}

	public static setWebClientFactory(value: () => WebClientLike) { WebApiClient._webClientFactory = value; }
	public static removeWebClientFactory() { delete WebApiClient._webClientFactory; }

	public get log() {
		if (this._log !== null) {
			return this._log;
		}
		this._log = loggerFactory.getLogger(this.constructor.name);
		if (this._webClient instanceof WebClient) {
			this._webClient.log = this._log;
		}
		return this._log;
	}
	public set log(value: Logger) {
		if (this._webClient instanceof WebClient) {
			this._webClient.log = value;
		}
		this._log = value;
	}

	public dispose(): Promise<void> {
		if (this._limit) {
			return this._limit.instance.dispose();
		}
		return Promise.resolve();
	}

	protected get baseUrl(): URL { return this._baseUrl; }

	protected invokeWebMethodGet(webMethodName: string,
		queryArgs?: { [key: string]: string }, headers?: http.OutgoingHttpHeaders
	): Promise<any> {
		let path = webMethodName;
		if (queryArgs) {
			path += "?" + querystring.stringify(queryArgs);
		}

		return this.invokeGet(path, headers);
	}
	protected invokeWebMethodPost(webMethodName: string,
		postArgs: { [key: string]: string }, headers?: http.OutgoingHttpHeaders
	): Promise<any> {
		const bodyStr = querystring.stringify(postArgs);
		const body: Buffer = Buffer.from(bodyStr);

		const postHeaders = {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": body.byteLength
		};

		return this.invokePost(webMethodName, body, Object.assign(postHeaders, headers));
	}
	protected async invokeGet(path: string, headers?: http.OutgoingHttpHeaders): Promise<any> {
		let limitToken: LimitToken | null = null;
		if (this._limit !== undefined) {
			limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500);
		}
		try {
			const url: URL = new URL(path, this._baseUrl);
			const result = await this._webClient.invoke({ url, method: "GET", headers });
			return JSON.parse(result.toString());
		} finally {
			if (limitToken !== null) {
				limitToken.commit();
			}
		}
	}
	protected async invokePost(path: string, body: Buffer, headers?: http.OutgoingHttpHeaders): Promise<any> {
		let limitToken: LimitToken | null = null;
		if (this._limit !== undefined) {
			limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500);
		}
		try {
			const url: URL = new URL(path, this._baseUrl);
			const result = await this._webClient.invoke({ url, method: "POST", body, headers });
			return JSON.parse(result.toString());
		} finally {
			if (limitToken !== null) {
				limitToken.commit();
			}
		}
	}
}

export default WebApiClient;
