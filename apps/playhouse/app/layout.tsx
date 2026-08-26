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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
