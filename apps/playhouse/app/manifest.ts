import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Carnival PlayHouse",
    short_name: "PlayHouse",
    description: "The Carnival Life application for managing Plays.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f4ff",
    theme_color: "#6d3ff2",
    icons: [
      {
        src: "/icons/playhouse-theater.jpg",
        sizes: "315x315",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
