import { type getOctokit } from '@actions/github';
export declare const handleUnique: <K, T>() => readonly [Record<string, T[]>, (key: string, subkey: K, getValue: () => T | undefined) => void];
export declare const handleGenerate: (prettierConfig: any, getFile: ReturnType<typeof handleGetFile>) => {
    addFile(path: string, file: string): Promise<void>;
    files: {
        path: string;
        content: string;
        sha?: string | undefined;
    }[];
};
export type Repo = {
    owner: string;
    repo: string;
};
type Data = {
    content: string;
    sha: string;
};
export declare const handleGetFile: (octokit: ReturnType<typeof getOctokit>['rest'], defaultRepo: Repo) => <T extends boolean>(filePath: string, required: T, repo?: Repo) => Promise<T extends false ? Data | undefined : Data>;
export {};
