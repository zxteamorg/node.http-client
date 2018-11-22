import { DisposableLike } from "@zxteam/contract";
import * as http from "http";
import * as querystring from "querystring";
import { URL } from "url";
import { Limit, LimitToken } from "limit.js";
import loggerFactory, { Logger } from "@zxteam/logger";

import { WebClient, WebClientLike } from "./WebClient";
import { WebApiClientOpts } from "./WebApiClientOpts";

export class WebApiClient {
	private static _webClientFactory?: () => WebClientLike;
	private readonly _baseUrl: URL;
	private readonly _webClient: WebClientLike;
	private readonly _limit: Limit | null;
	private _limitTimeout: number;
	private _log: Logger | null;

	public constructor(opts: WebApiClientOpts) {
		this._baseUrl = new URL(opts.url);
		if (opts.webClient) {
			this._webClient = opts.webClient;
		} else if (WebApiClient._webClientFactory) {
			this._webClient = WebApiClient._webClientFactory();
		} else {
			this._webClient = new WebClient({ proxyOpts: opts.proxy });
		}
		this._limit = opts.limit || null;
		this._limitTimeout = 15000;
		this._log = null;
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

	public get limitTimeout(): number {
		return this._limitTimeout;
	}
	public set limitTimeout(value: number) {
		this._limitTimeout = value;
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
		if (this._limit !== null) {
			limitToken = await this._limit.accrueTokenLazy(this._limitTimeout);
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
		if (this._limit !== null) {
			limitToken = await this._limit.accrueTokenLazy(this._limitTimeout);
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
