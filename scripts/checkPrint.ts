// Re-prints every generated statement in the lib from its own contents and diffs
// against what is checked in. Those files were laid out by prettier, so this is what
// keeps #src/print honest now that prettier is gone from the bundle.
//
//   pnpm run check:print [path-to-use-phone-input]

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  printArray,
  printAssignment,
  printCallWithArray,
  printDefaultImport,
  printNamedImport,
  printObject,
  printUnion,
} from '#src/print';

const lib = resolve(process.argv[2] ?? '../use-phone-input', 'src');

let checked = 0;

const failures: string[] = [];

const check = (what: string, expected: string, actual: string) => {
  checked++;

  if (expected !== actual) {
    failures.push(
      `${what}\n--- checked in\n${expected}\n--- printed\n${actual}\n`,
    );
  }
};

/** every import line in the file, re-printed from its own parts */
const checkImports = (what: string, file: string) => {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const named = /^import \{(.+)\} from '(.+)';$/.exec(line);

    if (named) {
      check(
        `${what} import`,
        line,
        printNamedImport(
          named[1].split(',').map(name => name.trim()),
          named[2],
        ),
      );

      continue;
    }

    const fallback = /^import (\w+) from '(.+)';$/.exec(line);

    if (fallback) {
      check(
        `${what} import`,
        line,
        printDefaultImport(fallback[1], fallback[2]),
      );
    }
  }
};

/** the statement between the last import (or the jsdoc) and the trailing export */
const statementOf = (file: string) => {
  const body = readFileSync(file, 'utf8');

  const start = body.search(/^(const|type) /m);

  const end = body.indexOf('\n\nexport default ');

  return body.slice(start, end);
};

const itemsOf = (statement: string) => {
  const inner = statement.slice(
    statement.indexOf('[') + 1,
    statement.lastIndexOf(']'),
  );

  return inner.includes('\n')
    ? inner
        .split('\n')
        .map(line => line.trim().replace(/,$/, ''))
        .filter(Boolean)
    : inner.split(', ');
};

for (const iso2 of readdirSync(`${lib}/phoneNumberFormats`).filter(
  name => !name.endsWith('.ts'),
)) {
  checkImports(
    `phoneNumberFormats/${iso2}`,
    `${lib}/phoneNumberFormats/${iso2}/index.ts`,
  );

  const statement = statementOf(`${lib}/phoneNumberFormats/${iso2}/index.ts`);

  check(
    `phoneNumberFormats/${iso2}`,
    statement,
    printArray(`const ${iso2}: PhoneNumberData`, itemsOf(statement)),
  );
}

for (const iso2 of readdirSync(`${lib}/phoneNumberValidationPatterns`).filter(
  name => !name.endsWith('.ts'),
)) {
  const statement = statementOf(
    `${lib}/phoneNumberValidationPatterns/${iso2}/index.ts`,
  );

  check(
    `phoneNumberValidationPatterns/${iso2}`,
    statement,
    printAssignment(
      `const ${iso2}`,
      statement.slice(statement.indexOf('/^')).replace(/;$/, ''),
    ),
  );
}

checkImports(
  'phoneNumberValidationPatterns/index',
  `${lib}/phoneNumberValidationPatterns/index.ts`,
);

const barrel = statementOf(`${lib}/phoneNumberValidationPatterns/index.ts`);

check(
  'phoneNumberValidationPatterns/index',
  barrel,
  printObject(
    'const phoneNumberValidationPatterns',
    barrel
      .slice(barrel.indexOf('{') + 1, barrel.lastIndexOf('}'))
      .split('\n')
      .map(line => line.trim().replace(/,$/, ''))
      .filter(Boolean),
  ),
);

checkImports('phoneNumberUtils/index', `${lib}/phoneNumberUtils/index.ts`);

const utils = statementOf(`${lib}/phoneNumberUtils/index.ts`);

check(
  'phoneNumberUtils/index',
  utils,
  printCallWithArray(
    'const phoneNumberUtils',
    'createPhoneNumberUtils',
    itemsOf(utils),
  ),
);

const iso2Type = statementOf(`${lib}/types/ISO2.ts`);

check(
  'types/ISO2',
  iso2Type,
  printUnion(
    'ISO2',
    iso2Type
      .slice(iso2Type.indexOf('|'))
      .split('|')
      .map(value => value.trim().replace(/;$/, ''))
      .filter(Boolean),
  ),
);

if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`${failures.length} of ${checked} statements differ`);
  process.exit(1);
}

console.log(`${checked} generated statements match the checked-in files`);
