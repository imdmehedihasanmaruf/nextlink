// Support both env var names found in this repo (.env.example and legacy builds)
const configuredBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL;

const baseUrl =
    configuredBaseUrl ??
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000/api/v1" : "");

export function buildApiUrl(apiBaseUrl: string, path: string): string {
    const root = apiBaseUrl.trim().replace(/(?:\/api)+(?:\/v1)?\/?$/i, "");
    const endpoint = path.replace(/^\/+/, "").replace(/^(?:api\/)?v1\//i, "");
    return `${root}/api/v1/${endpoint}`;
}

export class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly errors?: Record<string, string[]>) {
        super(message);
        this.name = "ApiError";
    }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<{ data: T; meta?: Record<string, number> }> {
    if (!baseUrl) throw new ApiError("The API is not configured. Set NEXT_PUBLIC_API_BASE_URL before deploying.", 0);
    const url = buildApiUrl(baseUrl, path);
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (typeof window !== "undefined") {
        const token = window.sessionStorage.getItem("isp-access-token");
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 15_000);

    let response: Response;
    let responseText: string;
    try {
        response = await fetch(url, { ...options, headers, cache: "no-store", signal: controller.signal });
        responseText = await response.text();
    } catch {
        if (timedOut) throw new ApiError("The API request timed out. Please try again.", 0);
        throw new ApiError("Unable to reach the API. Check the backend deployment and its CORS settings.", 0);
    } finally {
        clearTimeout(timeout);
    }

    const body = (() => {
        try {
            return JSON.parse(responseText) as { message?: string; errors?: Record<string, string[]>; data?: T; meta?: Record<string, number> };
        } catch {
            return {};
        }
    })();
    if (!response.ok) {
        const message = body.message ?? (response.status >= 500 ? "The API server encountered an error. Please try again later." : `Request failed (${response.status}).`);
        throw new ApiError(message, response.status, body.errors);
    }
    return { data: (body.data ?? body) as T, meta: body.meta };
}
