export const handleUnique = <K, T>() => {
  const map = new Map<string, Set<K>>();

  const obj: Record<string, T[]> = {};

  return [
    obj,
    (key: string, subkey: K, getValue: () => T | undefined) => {
      let isUnique = false;

      if (map.has(key)) {
        const set = map.get(key)!;

        if (!set.has(subkey)) {
          set.add(subkey);

          isUnique = true;
        }
      } else {
        isUnique = true;

        map.set(key, new Set([subkey]));
      }

      if (isUnique) {
        if (!(key in obj)) {
          obj[key] = [];
        }

        const value = getValue();

        if (value) {
          obj[key].push(value);
        }
      }
    },
  ] as const;
};

export const handleGenerate = (repo: Repo, brunch: string) => {
  const COMMENT = `// GENERATED FILE - DO NOT EDIT\n\n// This file has been automatically generated. Any modifications made to this file will be overwritten the next time it is regenerated. Please refrain from editing this file directly.\n\n`;

  type File = {
    path?: string;
    mode?: '100644' | '100755' | '040000' | '160000' | '120000';
    type?: 'blob' | 'tree' | 'commit';
    sha?: string | null;
    content?: string;
  };

  const files: File[] = [];

  return {
    // `file` arrives already laid out by #src/print, so there is nothing to format
    async addFile(path: string, file: string) {
      const newFileContent = `${COMMENT}${file}\n`;

      const prevFile = await getFile(path, false, repo, brunch);

      if (!prevFile || prevFile !== newFileContent) {
        const file: File = {
          path,
          content: newFileContent,
          mode: '100644',
          type: 'blob',
        };

        files.push(file);
      }
    },
    files,
  };
};

export type Repo = { owner: string; repo: string };

export const getFile = async <T extends boolean>(
  filePath: string,
  required: T,
  repo: Repo,
  brunch: string,
  attempt = 4,
): Promise<T extends false ? string | undefined : string> => {
  const res = await fetch(
    `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${brunch}/${filePath}`,
  );

  if (res.ok) {
    const data = await res.text();

    if (!data) {
      throw new Error(`${filePath} failed, no content`);
    }

    return data;
  }

  if (res.status === 503 && attempt) {
    await new Promise(resolve => setTimeout(resolve, 300));

    return getFile(filePath, required, repo, brunch, attempt - 1);
  }

  if (!required && res.status === 404) {
    return undefined!;
  }

  throw new Error(`${filePath} failed, ${res.status} ${res.statusText}`);
};

// Everything written into the generated sources comes from google/libphonenumber's
// master branch, unpinned. These values land inside string literals, regex literals,
// jsdoc comments and file paths, so a stray quote, slash or newline would not merely
// break the build - it would inject code into a package that publishes itself. Fail
// the sync instead, loudly.
const assertSafe = (what: string, value: string, rejected: RegExp) => {
  if (rejected.test(value)) {
    throw new Error(
      `unexpected characters in ${what}: ${JSON.stringify(value)}`,
    );
  }
};

/** used as an identifier and as a path segment */
export const assertSafeIso2 = (iso2: string) => {
  if (!/^[A-Z]{2}$/.test(iso2)) {
    throw new Error(`unexpected iso2: ${JSON.stringify(iso2)}`);
  }
};

/** goes inside a single-quoted string literal */
export const assertSafeFormat = (format: string) =>
  assertSafe('format', format, /[^0-9 ()+.-]/);

/** goes inside a regex literal */
export const assertSafePattern = (pattern: string) =>
  assertSafe('pattern', pattern, /[\n\r/]/);

/** goes inside a `/** ... *\/` comment */
export const assertSafeComment = (text: string) =>
  assertSafe('country name', text, /\*\//);
