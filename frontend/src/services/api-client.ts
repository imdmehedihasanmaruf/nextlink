// Support both env var names found in this repo (.env.example and legacy builds)
const configuredBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL;

const baseUrl =
    configuredBaseUrl ??
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000/api/v1" : "");

export class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly errors?: Record<string, string[]>) {
        super(message);
        this.name = "ApiError";
    }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<{ data: T; meta?: Record<string, number> }> {
    if (!baseUrl) throw new ApiError("The API is not configured. Set NEXT_PUBLIC_API_BASE_URL before deploying.", 0);
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (typeof window !== "undefined") {
        const token = window.sessionStorage.getItem("isp-access-token");
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, { ...options, headers, cache: "no-store" });
    } catch {
        throw new ApiError("The API is unavailable. Check that the Laravel server is running.", 0);
    }

    const body = await response.json().catch(() => ({})) as { message?: string; errors?: Record<string, string[]>; data?: T; meta?: Record<string, number> };
    if (!response.ok) throw new ApiError(body.message ?? `Request failed (${response.status}).`, response.status, body.errors);
    return { data: (body.data ?? body) as T, meta: body.meta };
}
