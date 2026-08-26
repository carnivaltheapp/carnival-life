import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Carnival PlayHouse",
  title: "Carnival PlayHouse",
  description: "The Carnival Life application for managing Plays.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/carnival-mark.svg",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#6d3ff2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const buildVersion = process.env.NEXT_PUBLIC_CARNIVAL_BUILD_VERSION;

  return (
    <html lang="en">
      <body>
        {children}
        {buildVersion ? (
          <small className="versionStamp">Version {buildVersion}</small>
        ) : null}
      </body>
    </html>
  );
}
