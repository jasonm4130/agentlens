// Vite's `import.meta.glob`, which vitest resolves at transform time. Declared here because
// core's tsconfig loads no ambient types (src must not see Node or Vite globals).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options: { eager: true; import: "default" },
  ): Record<string, T>;
}
