// The generated files used to be run through prettier, which cost ~730 KB of bundle
// to lay out a handful of fixed shapes. These helpers reproduce prettier's output for
// exactly those shapes - `pnpm run check:print` diffs them against the real files.

const PRINT_WIDTH = 80;

const INDENT = '  ';

const fits = (line: string) => line.length <= PRINT_WIDTH;

/** `import NAME from 'FROM';` */
export const printDefaultImport = (name: string, from: string) =>
  `import ${name} from '${from}';`;

/** `import { A, B } from 'FROM';` */
export const printNamedImport = (names: string[], from: string) =>
  `import { ${names.join(', ')} } from '${from}';`;

const broken = (items: string[]) =>
  items.map(item => `${INDENT}${item},\n`).join('');

/** `const NAME = VALUE;`, broken after the `=` when it does not fit */
export const printAssignment = (head: string, value: string) => {
  const oneLine = `${head} = ${value};`;

  return fits(oneLine) ? oneLine : `${head} =\n${INDENT}${value};`;
};

/** `const NAME = [a, b];`, one item per line when it does not fit */
export const printArray = (head: string, items: string[]) => {
  const oneLine = `${head} = [${items.join(', ')}];`;

  return fits(oneLine) ? oneLine : `${head} = [\n${broken(items)}];`;
};

/** `const NAME = { a, b };`, one key per line when it does not fit */
export const printObject = (head: string, keys: string[]) => {
  const oneLine = `${head} = { ${keys.join(', ')} };`;

  return fits(oneLine) ? oneLine : `${head} = {\n${broken(keys)}};`;
};

/** `const NAME = fn([a, b]);` - prettier hugs a sole array argument */
export const printCallWithArray = (
  head: string,
  fn: string,
  items: string[],
) => {
  const oneLine = `${head} = ${fn}([${items.join(', ')}]);`;

  return fits(oneLine) ? oneLine : `${head} = ${fn}([\n${broken(items)}]);`;
};

/**
 * `type NAME = 'a' | 'b';` - prettier breaks a union in two steps: first onto its
 * own indented line, and only if that still overflows, one member per line
 */
export const printUnion = (name: string, values: string[]) => {
  const head = `type ${name} =`;

  const members = values.join(' | ');

  if (fits(`${head} ${members};`)) {
    return `${head} ${members};`;
  }

  if (fits(`${INDENT}${members};`)) {
    return `${head}\n${INDENT}${members};`;
  }

  return `${head}\n${values.map(value => `${INDENT}| ${value}`).join('\n')};`;
};
