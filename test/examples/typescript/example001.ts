import * as zxteam from "@zxteam/contract";
// import { HttpClient } from  "@zxteam/http-client";
import { HttpClient } from "../../..";

import * as http from "http";

const cancellationToken: zxteam.CancellationToken = {
	isCancellationRequested: false,
	addCancelListener(cb: Function): void { /* dummy */ },
	removeCancelListener(cb: Function): void { /* dummy */ },
	throwIfCancellationRequested(): void { /* dummy */ }
};

async function main() {
	const httpClient = new HttpClient();

	const request: HttpClient.Request = {
		url: new URL("http://httpbin.org/ip"),
		method: "GET",
		headers: { "Accept": "*/*" }
	};

	const response: HttpClient.Response = await httpClient.invoke(cancellationToken, request);

	const statusCode: number = response.statusCode;
	const statusMessage: string = response.statusDescription;
	const headers: http.IncomingHttpHeaders = response.headers;
	const body: Buffer = response.body;

	console.log(statusCode);
	console.log(statusMessage);
	console.log(headers);
	console.log(body.toString());
}

main().catch(console.error);
