import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nexlink Internet | Fibre, forward.", template: "%s | Nexlink Internet" },
  description: "Internet service information and account management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
