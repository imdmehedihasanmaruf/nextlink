import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, buildApiUrl } from "./api-client";

describe("apiRequest", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("builds the versioned login URL from an API root", () => {
        expect(buildApiUrl("https://nextlink-backend.vercel.app/api", "auth/login"))
            .toBe("https://nextlink-backend.vercel.app/api/v1/auth/login");
        expect(buildApiUrl("https://nextlink-backend.vercel.app/api/v1", "auth/login"))
            .toBe("https://nextlink-backend.vercel.app/api/v1/auth/login");
        expect(buildApiUrl("https://nextlink-backend.vercel.app/api", "api/v1/auth/login"))
            .toBe("https://nextlink-backend.vercel.app/api/v1/auth/login");
        expect(buildApiUrl("https://nextlink-backend.vercel.app/api/api", "auth/login"))
            .toBe("https://nextlink-backend.vercel.app/api/v1/auth/login");
    });

    it("returns data and attaches session-scoped bearer tokens", async () => {
        vi.stubGlobal("window", { sessionStorage: { getItem: () => "short-lived-token" } });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ id: 1 }], meta: { total: 1 } }), { status: 200 }));
        vi.stubGlobal("fetch", fetch);
        await expect(apiRequest<{ id: number }[]>("packages")).resolves.toEqual({ data: [{ id: 1 }], meta: { total: 1 } });
        expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer short-lived-token");
    });

    it("reports backend server failures without exposing an empty response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
        await expect(apiRequest("auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({
            status: 500,
            message: "The API server encountered an error. Please try again later.",
        });
    });

    it("explains network failures as backend or CORS availability issues", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        await expect(apiRequest("auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({
            status: 0,
            message: "Unable to reach the API. Check the backend deployment and its CORS settings.",
        });
    });

    it("reports server validation errors without pretending success", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Invalid", errors: { email: ["Required"] } }), { status: 422 })));
        await expect(apiRequest("auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 422, errors: { email: ["Required"] } });
    });
});
