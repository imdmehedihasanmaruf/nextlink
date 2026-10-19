import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";

describe("apiRequest", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("returns data and attaches session-scoped bearer tokens", async () => {
        vi.stubGlobal("window", { sessionStorage: { getItem: () => "short-lived-token" } });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ id: 1 }], meta: { total: 1 } }), { status: 200 }));
        vi.stubGlobal("fetch", fetch);
        await expect(apiRequest<{ id: number }[]>("packages")).resolves.toEqual({ data: [{ id: 1 }], meta: { total: 1 } });
        expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer short-lived-token");
    });

    it("reports server validation errors without pretending success", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Invalid", errors: { email: ["Required"] } }), { status: 422 })));
        await expect(apiRequest("auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 422, errors: { email: ["Required"] } });
    });
});
