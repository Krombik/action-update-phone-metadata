import * as core from '@actions/core';
import * as github from '@actions/github';
import { XMLParser } from 'fast-xml-parser';
import { parse, Options } from 'csv-parse/sync';
import { Repo, handleGenerate, getFile, handleUnique } from './utils';

type Metadata = Record<
  'Calling Code' | 'Extra Regions' | 'Main Region',
  string
>;

type FormatData = {
  format: string;
  length: number;
  index: number;
};

type CountryData = {
  iso2: string;
  pattern: string;
  formats: FormatData[];
  mainCountryForCode: boolean;
  leadingDigits?: string;
};

interface Welcome2 {
  phoneNumberMetadata: {
    territories: {
      __comment: string[];
      territory: Territory[];
    };
  };
}

interface Territory {
  mobile?: {
    nationalNumberPattern: string;
  };
  _id: string;
  _countryCode: string;
  _leadingDigits?: string;
  _mainCountryForCode?: string;
}

async function run(): Promise<void> {
  core.info('start');

  const baseBranch = 'main';

  const MASK_SYMBOL = '0';

  const INTERNAL = '/** @internal */\n';

  const googleBaseBranch = 'master';

  const octokit = github.getOctokit(core.getInput('my-token')).rest;

  const myRepo = github.context.repo;

  try {
    const { files, addFile } = handleGenerate(
      JSON.parse(await getFile('.prettierrc', true, myRepo, baseBranch)),
      myRepo,
      baseBranch,
    );

    core.info('prettier config loaded');

    const enum Names {
      CONSTANTS = 'constants',

      PHONE_NUMBER_UTILS = 'phoneNumberUtils',

      CREATE_PHONE_NUMBER_UTILS = 'createPhoneNumberUtils',

      PHONE_NUMBER_FORMATS = 'phoneNumberFormats',

      PHONE_NUMBER_FORMAT = 'PhoneNumberFormat',

      PHONE_VALIDATION_PATTERNS = 'phoneValidationPatterns',

      ISO2 = 'iso2',
    }

    const [withoutFormatObj, addToWithoutFormatObj] = handleUnique<
      number,
      FormatData
    >();

    const [formatObj, addToFormatObj] = handleUnique<string, FormatData>();

    const parserOptions: Options = {
      columns: true,
      delimiter: ';',
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
    };

    const googleRepo: Repo = { owner: 'google', repo: 'libphonenumber' };

    const metadata: Metadata[] = parse(
      await getFile(
        'resources/metadata/metadata.csv',
        true,
        googleRepo,
        googleBaseBranch,
      ),
      {
        ...parserOptions,
        onRecord(record: Metadata) {
          if (record['Main Region'] !== '001') {
            return record;
          }
        },
      },
    );

    core.info('metadata.csv loaded');

    for (let i = 0; i < metadata.length; i++) {
      type Ranges = Record<
        | 'Prefix'
        | 'Regions'
        | 'Length'
        | 'Area Code Length'
        | 'Format'
        | 'Type',
        string
      >;

      type Format = Record<'Id' | 'International', string>;

      const callingCode = metadata[i]['Calling Code'];

      const formatsCvs = await getFile(
        `resources/metadata/${callingCode}/formats.csv`,
        false,
        googleRepo,
        googleBaseBranch,
      );

      const formats =
        formatsCvs && (parse(formatsCvs, parserOptions) as Format[]);

      const lll = await getFile(
        `resources/metadata/${callingCode}/ranges.csv`,
        true,
        googleRepo,
        googleBaseBranch,
      );

      if (!lll) {
        core.info(`${callingCode} is empty`);
      }

      parse(lll, {
        onRecord(record: Ranges) {
          if (
            record.Type === 'MOBILE' ||
            record.Type === 'FIXED_LINE_OR_MOBILE'
          ) {
            const regions = record.Regions.split(',');

            const format = record.Format;

            const arr = record.Length.split(/[-,]/);

            const length = +arr[arr.length - 1];

            for (let i = regions.length; i--; ) {
              const iso2 = regions[i];

              if (formats && format) {
                addToFormatObj(iso2, format, () => {
                  const value = formats.find(
                    (item: any) => item.Id === format,
                  )!.International;

                  if (value && value.indexOf('{X>}') == -1) {
                    return {
                      format: value.replace(/[*X]/g, MASK_SYMBOL),
                      length,
                      index: -1,
                    };
                  }
                });
              } else {
                addToWithoutFormatObj(iso2, length, () => ({
                  format: Array.from({ length }, () => MASK_SYMBOL).join(''),
                  length,
                  index: -1,
                }));
              }
            }
          }
        },
        ...parserOptions,
      });
    }

    for (const key in withoutFormatObj) {
      if (!(key in formatObj)) {
        formatObj[key] = withoutFormatObj[key];
      }
    }

    for (const key in formatObj) {
      const format = formatObj[key];

      if (format.length > 1) {
        const set = new Set<number>();

        const arr: CountryData['formats'] = [];

        for (let i = 0; i < format.length; i++) {
          const item = format[i];

          const length = item.length;

          if (!set.has(length)) {
            set.add(length);

            arr.push(item);
          }
        }

        arr.sort((a, b) => a.length - b.length);

        formatObj[key] = arr.filter((item, index, self) => {
          return !self.some(
            (kek, j) => j != index && kek.format.startsWith(item.format),
          );
        });
      }
    }

    const formatsList: { format: string; repeatingTimes: number }[] = [];

    for (const key in formatObj) {
      const formats = formatObj[key];

      for (let i = 0; i < formats.length; i++) {
        const format = formats[i];

        let index = -1;

        for (let j = 0; j < formatsList.length; j++) {
          const existingFormat = formatsList[j];

          if (existingFormat.format.startsWith(format.format)) {
            existingFormat.repeatingTimes++;

            index = j;

            break;
          } else if (format.format.startsWith(existingFormat.format)) {
            index = j;

            existingFormat.format = format.format;

            existingFormat.repeatingTimes++;

            break;
          }
        }

        if (index < 0) {
          format.index = formatsList.length;

          formatsList.push({ format: format.format, repeatingTimes: 0 });
        } else {
          format.index = index;
        }
      }
    }

    core.info('formats handled');

    const { territories } = (
      new XMLParser({
        ignoreAttributes: false,
        parseTagValue: false,
        allowBooleanAttributes: true,
        parseAttributeValue: false,
        attributeNamePrefix: '_',
        commentPropName: '__comment',
      }).parse(
        await getFile(
          'resources/PhoneNumberMetadata.xml',
          true,
          googleRepo,
          googleBaseBranch,
        ),
      ) as Welcome2
    ).phoneNumberMetadata;

    core.info('PhoneNumberMetadata.xml loaded');

    const nameDictionary = {} as Record<string, string>;

    const iso2Dictionary = {} as Record<string, string>;

    territories.__comment.forEach(str => {
      const item = /^ (.+) \((\w{2})\) $/.exec(str);

      if (item) {
        const name = item[1];

        const iso2 = item[2];

        nameDictionary[name] = iso2;

        iso2Dictionary[iso2] = name;
      }
    });

    iso2Dictionary.RU = '404';

    const data = territories.territory;

    const map: Record<string, CountryData[]> = {};

    for (let i = 0; i < data.length; i++) {
      const { mobile, _id, _countryCode, _leadingDigits, _mainCountryForCode } =
        data[i];

      if (_id === '001' || !mobile) {
        continue;
      }

      if (!formatObj[_id]) {
        core.info(`${_id} formats is absent`);
      }

      const country: CountryData = {
        iso2: _id,
        pattern: mobile.nationalNumberPattern.replace(/[ \n]/g, ''),
        formats: formatObj[_id],
        leadingDigits: _leadingDigits,
        mainCountryForCode: _mainCountryForCode === 'true',
      };

      if (_countryCode in map) {
        const arr = map[_countryCode];

        const index = arr.findIndex(
          country.leadingDigits
            ? item => item.leadingDigits === country.leadingDigits
            : item => item.pattern === country.pattern,
        );

        if (index < 0) {
          arr.push(country);
        } else if (country.mainCountryForCode) {
          arr[index] = country;
        }
      } else {
        map[_countryCode] = [country];
      }
    }

    let formatsFile = '';

    const formatsVariableSet = new Set<string>();

    let longestNumber = 0;

    let longestCallingCode = 0;

    const countries: Set<string> = new Set();

    for (const key in map) {
      const item = map[key];

      if (key.length > longestCallingCode) {
        longestCallingCode = key.length;
      }

      for (let i = 0; i < item.length; i++) {
        const country = item[i];

        let _import = `import {${Names.PHONE_NUMBER_FORMAT}} from '../../types';\n\n`;

        const iso2 = country.iso2.toUpperCase();

        const countryNameComment = `/** ${iso2Dictionary[iso2]} */\n`;

        let str = `${countryNameComment}const ${iso2}: ${
          Names.PHONE_NUMBER_FORMAT
        }=[${key},'${country.iso2}',${country.formats
          .reduce<(string | number)[]>((acc, item) => {
            if (item.length > longestNumber) {
              longestNumber = item.length;
            }

            acc.push(item.length);

            const variable = formatsList[item.index];

            if (variable.repeatingTimes) {
              const variableName = `format${item.index}`;

              if (!formatsVariableSet.has(variableName)) {
                formatsVariableSet.add(variableName);

                formatsFile += `${INTERNAL}export const ${variableName}='${variable.format}';\n\n`;
              }

              _import += `import {${variableName}} from '../../utils/${Names.CONSTANTS}';\n\n`;

              acc.push(variableName);
            } else {
              acc.push(`'${item.format}'`);
            }

            return acc;
          }, [])
          .join(',')}`;

        if (item.length > 1 && !country.mainCountryForCode) {
          str += `,/^(?:${
            country.leadingDigits ||
            country.pattern.replace(/\\d(?:\{\d+\})?/g, '')
          })/`;
        }

        countries.add(iso2);

        await addFile(
          `src/${Names.PHONE_NUMBER_FORMATS}/${iso2}/index.ts`,
          `${_import}${str}];\n\nexport default ${iso2};`,
        );

        await addFile(
          `src/${Names.PHONE_VALIDATION_PATTERNS}/${iso2}/index.ts`,
          `${countryNameComment}const ${iso2}=/^(?:${country.pattern})$/;\n\nexport default ${iso2};`,
        );
      }
    }

    if (countries.size) {
      const arr1 = Array.from(countries).sort();

      await addFile(
        `src/${Names.PHONE_VALIDATION_PATTERNS}/index.ts`,

        `${arr1
          .map(iso2 => `import ${iso2} from './${iso2}';`)
          .join('\n')}\n\nconst ${Names.PHONE_VALIDATION_PATTERNS}={${arr1.join(
          ',',
        )}};\n\nexport default ${Names.PHONE_VALIDATION_PATTERNS};`,
      );

      await addFile(
        `src/types/${Names.ISO2}.ts`,
        `type ISO2=${arr1
          .map(item => `'${item}'`)
          .join('|')};\n\nexport default ISO2;`,
      );

      const arr2 = Object.keys(nameDictionary)
        .sort()
        .reduce((acc, name) => {
          const iso2 = nameDictionary[name];

          if (countries.has(iso2)) {
            acc.push(iso2);
          }

          return acc;
        }, [] as string[]);

      await addFile(
        `src/${Names.PHONE_NUMBER_UTILS}/index.ts`,
        `${arr2
          .map(
            iso2 =>
              `import ${iso2} from '../${Names.PHONE_NUMBER_FORMATS}/${iso2}';`,
          )
          .join('\n')}\n\nimport ${Names.CREATE_PHONE_NUMBER_UTILS} from '../${
          Names.CREATE_PHONE_NUMBER_UTILS
        }';\n\nconst ${Names.PHONE_NUMBER_UTILS} = ${
          Names.CREATE_PHONE_NUMBER_UTILS
        }([${arr2.join(',')}]);\n\nexport default ${Names.PHONE_NUMBER_UTILS};`,
      );
    }

    await addFile(
      `src/utils/${Names.CONSTANTS}.ts`,
      `${INTERNAL}export const MAX_CALLING_CODE_LENGTH=${longestCallingCode};\n\n${INTERNAL}export const MAX_NUMBER_LENGTH=${longestNumber};\n\n${INTERNAL}export const MASK_SYMBOL='${MASK_SYMBOL}';\n\n${formatsFile}`,
    );

    if (files.length) {
      const newBranch = 'next';

      const commitSHA = (
        await octokit.git.createRef({
          ...myRepo,
          ref: `refs/heads/${newBranch}`,
          sha: (
            await octokit.repos.getBranch({ ...myRepo, branch: baseBranch })
          ).data.commit.sha,
        })
      ).data.object.sha;

      const newTreeSHA = (
        await octokit.git.createTree({
          ...myRepo,
          tree: files,
        })
      ).data.sha;

      const commitMessage = 'Commit changes';

      await octokit.git.updateRef({
        ...myRepo,
        ref: `refs/heads/${newBranch}`,
        sha: (
          await octokit.git.createCommit({
            ...myRepo,
            message: commitMessage,
            tree: newTreeSHA,
            parents: [commitSHA],
          })
        ).data.sha,
      });

      const pullRequestTitle = 'New Pull Request';
      const pullRequestBody = 'This is a new pull request';

      await octokit.pulls.create({
        ...myRepo,
        title: pullRequestTitle,
        body: pullRequestBody,
        head: newBranch,
        base: baseBranch,
      });
    }

    core.info(`updated ${files.length} files`);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
