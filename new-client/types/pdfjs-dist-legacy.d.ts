// Ambient module declarations to satisfy TypeScript for dynamic pdfjs-dist imports
// Vercel build was failing: Cannot find module 'pdfjs-dist/legacy/build/pdf'
// These paths exist at runtime in the pdfjs-dist package, but no type definitions are published for them.
// We declare them as 'any' to allow dynamic loading with fallback without forcing dependency on DOM types.
declare module 'pdfjs-dist/legacy/build/pdf' {
  const pdfjs: any;
  export = pdfjs;
}

declare module 'pdfjs-dist/build/pdf' {
  const pdfjs: any;
  export = pdfjs;
}
