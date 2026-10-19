import { PageHero } from "@/components/pages/public-pages";
import { LivePublicPackages } from "@/components/pages/live-public-packages";
export default function Page() { return <><PageHero eyebrow="FIND YOUR HAPPY PLACE" title={<>Speed that fits.<br /><span>Life that flows.</span></>} text="Explore currently available internet packages." /><section className="section packages-section"><div className="container"><LivePublicPackages /></div></section></>; }
