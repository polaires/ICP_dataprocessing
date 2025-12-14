import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICP Lanthanide Data Viewer",
  description: "Analyze lanthanide binding protein selectivity from ICP-OES data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
