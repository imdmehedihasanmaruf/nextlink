import { demoInvoices, demoPackages, demoSubscribers, demoTickets } from "@/data/demo";

/** UI-facing read services. Replace these typed functions with Laravel API calls in a later phase. */
export const demoService = {
    async getPackages() { return [...demoPackages]; },
    async getSubscribers() { return [...demoSubscribers]; },
    async getInvoices() { return [...demoInvoices]; },
    async getTickets() { return [...demoTickets]; },
    async checkCoverage(district: string, area: string) {
        const available = district === "Dhaka" && ["Dhanmondi", "Uttara", "Bashundhara"].includes(area);
        const needsConfirmation = district === "Dhaka" && area === "Mohammadpur";
        return { available, needsConfirmation, demo: true as const };
    },
    async submitConnectionRequest() { return { accepted: true as const, demo: true as const, message: "Demonstration only; no request was sent." }; },
    async selectPaymentGateway(gateway: "bKash" | "Nagad" | "Rocket" | "SSLCommerz") { return { gateway, connected: false as const, demo: true as const }; },
};
