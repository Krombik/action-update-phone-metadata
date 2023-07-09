var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { format } from 'prettier';
export const handleUnique = () => {
    const map = new Map();
    const obj = {};
    return [
        obj,
        (key, subkey, getValue) => {
            let isUnique = false;
            if (map.has(key)) {
                const set = map.get(key);
                if (!set.has(subkey)) {
                    set.add(subkey);
                    isUnique = true;
                }
            }
            else {
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
    ];
};
export const handleGenerate = (prettierConfig, getFile) => {
    const COMMENT = `// GENERATED FILE - DO NOT EDIT\n\n// This file has been automatically generated. Any modifications made to this file will be overwritten the next time it is regenerated. Please refrain from editing this file directly.\n\n`;
    const files = [];
    return {
        addFile(path, file) {
            return __awaiter(this, void 0, void 0, function* () {
                const newFileContent = yield format(COMMENT + file, prettierConfig);
                const prevFile = yield getFile(path, false);
                if (!prevFile || prevFile.content !== newFileContent) {
                    const file = {
                        path,
                        content: Buffer.from(newFileContent, 'utf8').toString('base64'),
                    };
                    if (prevFile) {
                        file.sha = prevFile.sha;
                    }
                    files.push(file);
                }
            });
        },
        files,
    };
};
export const handleGetFile = (octokit, defaultRepo) => (filePath, required, repo) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data } = yield octokit.repos.getContent(Object.assign(Object.assign({}, (repo || defaultRepo)), { path: filePath }));
        if (!('content' in data)) {
            throw new Error(`no content`);
        }
        return {
            content: Buffer.from(data.content, 'base64').toString('utf8'),
            sha: data.sha,
        };
    }
    catch (error) {
        if (!required && error.status === 404) {
            return undefined;
        }
        throw new Error(`${filePath} failed, ${error.message}`);
    }
});
//# sourceMappingURL=utils.js.map