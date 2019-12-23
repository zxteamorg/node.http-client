import { DUMMY_CANCELLATION_TOKEN } from "@zxteam/cancellation";
import { HttpClient } from "../../../src/index";

import * as http from "http";

async function main() {
	const httpClient = new HttpClient();

	const request: HttpClient.Request = {
		url: new URL("http://httpbin.org/ip"),
		method: "GET",
		headers: { "Accept": "*/*" }
	};

	const response: HttpClient.Response = await httpClient.invoke(DUMMY_CANCELLATION_TOKEN, request);

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
