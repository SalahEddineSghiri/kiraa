/** @type {import('next').NextConfig} */
export default {
  experimental: {
    cpus: 1,
    webpackBuildWorker: false,
    serverActions: { bodySizeLimit: "10mb" },
    serverComponentsExternalPackages: ["pdfkit", "pdf-parse"],
  },
};
