import { notFound } from "next/navigation";
import { AdminResourcePage } from "@/components/pages/portal-pages";
import { LiveSubscribers } from "@/components/pages/live-subscribers";
import { LivePackages } from "@/components/pages/live-packages";
import { LiveBilling } from "@/components/pages/live-billing";
import { LivePayments } from "@/components/pages/live-payments";
import { LiveTickets } from "@/components/pages/live-tickets";
import { LiveTechnicians } from "@/components/pages/live-technicians";
import { LiveRouters } from "@/components/pages/live-mikrotik";
import { LiveReports } from "@/components/pages/live-reports";
import { LiveStaff } from "@/components/pages/live-staff";
import { LiveSettings } from "@/components/pages/live-settings";
const sections = ["subscribers", "packages", "billing", "payments", "mikrotik", "tickets", "technicians", "reports", "staff", "settings"];
export function generateStaticParams() { return sections.map((section) => ({ section })); }
export default async function Page({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (!sections.includes(section)) notFound(); return section === "subscribers" ? <LiveSubscribers /> : section === "packages" ? <LivePackages /> : section === "billing" ? <LiveBilling /> : section === "payments" ? <LivePayments /> : section === "tickets" ? <LiveTickets /> : section === "technicians" ? <LiveTechnicians /> : section === "mikrotik" ? <LiveRouters /> : section === "reports" ? <LiveReports /> : section === "staff" ? <LiveStaff /> : section === "settings" ? <LiveSettings /> : <AdminResourcePage section={section} />; }
