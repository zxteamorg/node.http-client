import { DisposableLike } from "@zxteam/contract";
import * as http from "http";
import * as querystring from "querystring";
import { URL } from "url";
import { Limit, LimitToken } from "limit.js";

import { WebClient, WebClientLike } from "./WebClient";
import { WebApiClientOpts } from "./WebApiClientOpts";

export class WebApiClient {
	private static _webClientFactory?: () => WebClientLike;
	private readonly _baseUrl: URL;
	private readonly _webClient: WebClientLike;
	private readonly _limit: Limit | null;

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
	}

	public static setWebClientFactory(value: () => WebClientLike) { WebApiClient._webClientFactory = value; }
	public static removeWebClientFactory() { delete WebApiClient._webClientFactory; }

	protected get baseUrl(): URL { return this._baseUrl; }

	protected async limitThreshold(timeout: number): Promise<DisposableLike> {
		let limitToken: LimitToken | null = null;
		if (this._limit !== null) {
			limitToken = await this._limit.accrueTokenLazy(timeout);
		}
		const disposeStub = {
			dispose: async () => {
				if (limitToken !== null) {
					limitToken.commit();
				}
			}
		};
		return disposeStub;
	}

	protected callWebMethodGet(webMethodName: string,
		queryArgs?: { [key: string]: string }, headers?: http.OutgoingHttpHeaders
	): Promise<any> {
		let path = webMethodName;
		if (queryArgs) {
			path += "?" + querystring.stringify(queryArgs);
		}

		return this.invokeGet(path, headers);
	}
	protected callWebMethodPost(webMethodName: string,
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
		const url: URL = new URL(path, this._baseUrl);
		const result = await this._webClient.invoke({ url, method: "GET", headers });
		return JSON.parse(result.toString());
	}
	protected async invokePost(path: string, body: Buffer, headers?: http.OutgoingHttpHeaders): Promise<any> {
		const url: URL = new URL(path, this._baseUrl);
		const result = await this._webClient.invoke({ url, method: "POST", body, headers });
		return JSON.parse(result.toString());
	}
}

export default WebApiClient;
