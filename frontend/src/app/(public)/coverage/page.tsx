import { PageHero } from "@/components/pages/public-pages";
import { LiveCoverageCheck } from "@/components/pages/live-coverage-check";
export default function Page() { return <><PageHero eyebrow="LET’S FIND YOUR CONNECTION" title={<>Good internet,<br /><span>right at your door.</span></>} text="Check current service availability from our coverage records." /><section className="section coverage-page"><div className="container coverage-page-layout"><LiveCoverageCheck /></div></section></>; }
