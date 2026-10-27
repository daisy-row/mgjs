// esbuild loads these at build time: `.txt` as a string, `.gz` as bytes.
declare module '*.txt' {
  const text: string;
  export default text;
}
declare module '*.gz' {
  const bytes: Uint8Array;
  export default bytes;
}
