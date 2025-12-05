export type RehypePlugin = (...args: unknown[]) => (tree: unknown) => unknown;

const rehypeRaw: RehypePlugin = () => (tree) => tree;

export default rehypeRaw;
