// The build folder sits outside any workspace, so tracing has one obvious root.
export default { outputFileTracingRoot: import.meta.dirname, turbopack: { root: import.meta.dirname } };
