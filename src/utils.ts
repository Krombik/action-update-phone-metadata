import { format } from 'prettier';
import axios from 'axios';

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

export const handleGenerate = (
  prettierConfig: any,
  repo: Repo,
  brunch: string,
) => {
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
    async addFile(path: string, file: string) {
      const newFileContent = await format(COMMENT + file, prettierConfig);

      const prevFile = await getFile(path, false, repo, brunch);

      if (!prevFile || prevFile !== newFileContent) {
        const file: File = {
          path,
          content: Buffer.from(newFileContent, 'utf8').toString('base64'),
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
  try {
    const { data } = await axios.get(
      `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${brunch}/${filePath}`,
      { transformResponse: a => a },
    );

    if (!data) {
      throw new Error(`no content`);
    }

    return data;
  } catch (error: any) {
    const { status } = error.response;

    if (status === 503 && attempt) {
      return getFile(filePath, required, repo, brunch, attempt - 1);
    }

    if (!required && status === 404) {
      return undefined!;
    }

    throw new Error(`${filePath} failed, ${error.message}`);
  }
};
