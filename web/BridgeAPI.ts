import { ExchangeOpenAPIRequestBody, ExchangeOpenAPIResponseBody } from "matrix-appservice-bridge";
import { WidgetApi } from "matrix-widget-api";

export class BridgeAPIError extends Error {
    constructor(msg: string, private body: Record<string, unknown>) {
        super(msg);
    }
}

export default class BridgeAPI {

    static async getBridgeAPI(baseUrl: string, widgetApi: WidgetApi): Promise<BridgeAPI> {
        const sessionToken = localStorage.getItem('slackbridge-sessionToken');
        if (sessionToken) {
            const client = new BridgeAPI(baseUrl, sessionToken);
            try {
                await client.verify();
                return client;
            } catch (ex) {
                // Clear the token from the server, also actually check the error here.
                console.warn(`Failed to verify token, fetching new token`, ex);
                localStorage.removeItem(sessionToken);
            }
        }
        const creds = await widgetApi.requestOpenIDConnectToken();
        const { matrix_server_name, access_token } = creds;
        if (!matrix_server_name || !access_token) {
            throw Error('Server OpenID response missing values');
        }

        const req = await fetch(`${baseUrl}/v1/exchange_openid`, {
            cache: 'no-cache',
            method: 'POST',
            body: JSON.stringify({
                matrixServer: matrix_server_name,
                openIdToken: access_token,
            } as ExchangeOpenAPIRequestBody),
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (req.status !== 200) {
            throw Error(`Response was not 200: ${await req.text()}`);
        }
        const response = await req.json() as ExchangeOpenAPIResponseBody;
        localStorage.setItem('slackbridge-sessionToken', response.token);
        return new BridgeAPI(baseUrl, response.token);
    }

    constructor(private readonly baseUrl: string, private readonly accessToken: string) {}

    async request(method: string, endpoint: string, body?: unknown) {
        const req = await fetch(`${this.baseUrl}${endpoint}`, {
            cache: 'no-cache',
            method,
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`,
            },
        });
        if (req.status === 204) {
            return;
        }
        if (req.status === 200) {
            return req.json();
        }
        const resultBody = await req.json();
        throw new BridgeAPIError(resultBody?.error || 'Request failed', resultBody);
    }

    async verify() {
        return this.request('GET', `/v1/session`);
    }

    async searchUsers(query: string): Promise<{userId: string, displayName: string, rawAvatarUrl: string}[]> {
        return (await this.request('POST', `/v1/searchUsers`, { query })).users;
    }
}