import * as http from "http";
import { assert } from "chai";
import LimitFactory from "limit.js";

import { WebApiClient } from "../src";

describe("WebApiClient tests", function () {
	describe("Tests with limits", function () {
		class MyApiClient extends WebApiClient {
			public invokeGet(path: string, headers?: http.OutgoingHttpHeaders) {
				return super.invokeGet(path, headers);
			}
		}

		it("WebApiClient should GET http:", async function () {
			const apiClient = new MyApiClient({
				url: "http://www.google.com",
				limit: {
					opts: {
						perSecond: 2,
						perMinute: 4,
						perHour: 50,
						parallel: 2
					},
					timeout: 3000
				},
				webClient: {
					timeout: 1000
				}
			});
			try {
				const jobs: Array<Promise<void>> = [];
				const errors: Array<any> = [];
				let completeCount = 0;
				for (let index = 0; index < 10; index++) {
					jobs.push(
						apiClient.invokeGet("a")
							.then(() => { ++completeCount; })
							.catch((reason: any) => { errors.push(reason); })
					);
				}
				await new Promise((r) => setTimeout(r, 2500));
				assert.equal(completeCount + errors.length, 4);
			} finally {
				await apiClient.dispose();
			}
		});
	});
});
