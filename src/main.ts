import { getInput, info, setFailed, setOutput, warning } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'csv-parse/sync';
import type { Repo } from '#src/utils';
import {
  assertSafeComment,
  assertSafeFormat,
  assertSafeIso2,
  assertSafePattern,
  handleGenerate,
  getFile,
  handleUnique,
} from '#src/utils';
import {
  printArray,
  printAssignment,
  printCallWithArray,
  printDefaultImport,
  printNamedImport,
  printObject,
  printUnion,
} from '#src/print';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

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

interface PhoneNumberMetadataXml {
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
  info('start');

  const baseBranch = context.ref.replace('refs/heads/', '');

  const MASK_SYMBOL = '0';

  const INTERNAL = '/** @internal */\n';

  const googleBaseBranch = 'master';

  const octokit = getOctokit(getInput('gh-token')).rest;

  const SRC = 'src/';

  // the lib imports its own modules through its package.json `#src/*` subpath
  // imports, never relatively
  const alias = (filePath: string) =>
    `#src/${filePath.slice(SRC.length).replace(/\.ts$/, '')}`;

  const CONSTANTS_FILE_PATH = SRC + getInput('constants-file-path');

  const PHONE_NUMBER_DATA_TYPE_FILE_PATH =
    SRC + getInput('phone-number-data-type-file-path');

  const ISO2_TYPE_FILE_PATH = SRC + getInput('iso2-type-file-path');

  const PHONE_NUMBER_UTILS_FOLDER_PATH =
    SRC + getInput('phone-number-utils-folder-path');

  const CREATE_PHONE_NUMBER_UTILS_FOLDER_PATH =
    SRC + getInput('create-phone-number-utils-folder-path');

  const PHONE_NUMBER_FORMATS_FOLDER_PATH =
    SRC + getInput('phone-number-formats-folder-path');

  const PHONE_NUMBER_VALIDATION_PATTERNS_FOLDER_PATH =
    SRC + getInput('phone-number-validation-patterns-folder-path');

  const myRepo = context.repo;

  try {
    const { files, addFile } = handleGenerate(myRepo, baseBranch);

    const [withoutFormatObj, addToWithoutFormatObj] = handleUnique<
      number,
      FormatData
    >();

    const [formatObj, addToFormatObj] = handleUnique<string, FormatData>();

    const parserOptions = {
      columns: true,
      delimiter: ';',
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
    } as const;

    const googleRepo: Repo = { owner: 'google', repo: 'libphonenumber' };

    const metadata = parse<Metadata>(
      await getFile(
        'resources/metadata/metadata.csv',
        true,
        googleRepo,
        googleBaseBranch,
      ),
      {
        ...parserOptions,
        onRecord(record) {
          if (record['Main Region'] !== '001') {
            return record;
          }
        },
      },
    );

    info('metadata.csv loaded');

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

      const formats = formatsCvs && parse<Format>(formatsCvs, parserOptions);

      const ranges = await getFile(
        `resources/metadata/${callingCode}/ranges.csv`,
        true,
        googleRepo,
        googleBaseBranch,
      );

      if (!ranges) {
        info(`${callingCode} is empty`);
      }

      parse<Ranges>(ranges, {
        ...parserOptions,
        onRecord(record) {
          if (
            record.Type === 'MOBILE' ||
            record.Type === 'FIXED_LINE_OR_MOBILE'
          ) {
            const regions = record.Regions.split(',');

            const format = record.Format;

            const arr = record.Length.split(/[-,]/);

            const length = +arr[arr.length - 1];

            for (let i = regions.length; i--;) {
              const iso2 = regions[i];

              if (formats && format) {
                addToFormatObj(iso2, format, () => {
                  const value = formats.find(
                    item => item.Id === format,
                  )!.International;

                  if (value && value.indexOf('{X>}') == -1) {
                    let format = value.replace(/[*X]/g, MASK_SYMBOL);

                    let l = length;

                    // handling Argentina format https://github.com/google/libphonenumber/blob/master/resources/metadata/54/README
                    if (iso2 == 'AR') {
                      format = `${MASK_SYMBOL} ${format}`;

                      l++;
                    }

                    return {
                      format,
                      length: l,
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
      });
    }

    for (const key in withoutFormatObj) {
      // handleUnique creates the key before it knows whether the format is usable,
      // so a country whose every format was skipped is present but empty - it still
      // needs the plain-mask fallback
      if (!formatObj[key]?.length) {
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

        formatObj[key] = arr.filter(
          (item, index, self) =>
            !self.some(
              (data, j) => j != index && data.format.startsWith(item.format),
            ),
        );
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

    info('formats handled');

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
      ) as PhoneNumberMetadataXml
    ).phoneNumberMetadata;

    info('PhoneNumberMetadata.xml loaded');

    let skipped = 0;

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

      // without formats the country would emit `[callingCode, iso2]`, which is not
      // a valid PhoneNumberData - skip it loudly rather than failing the whole sync
      if (!formatObj[_id]?.length) {
        warning(`${_id} has no formats, skipping`);

        skipped++;

        continue;
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

    // the variable name is derived from the format itself, so it survives
    // unrelated formats being added or removed - a positional index renumbered
    // (and so rewrote) every country file on any change
    const formatVariableName = (format: string) =>
      `format${createHash('sha256').update(format).digest('hex').slice(0, 8)}`;

    const formatsVariables = new Map<string, string>();

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

        let _import = `${printDefaultImport(
          basename(
            PHONE_NUMBER_DATA_TYPE_FILE_PATH,
            extname(PHONE_NUMBER_DATA_TYPE_FILE_PATH),
          ),
          alias(PHONE_NUMBER_DATA_TYPE_FILE_PATH),
        )}\n\n`;

        const iso2 = country.iso2.toUpperCase();

        assertSafeIso2(iso2);

        assertSafeComment(iso2Dictionary[iso2]);

        assertSafePattern(country.pattern);

        const countryNameComment = `/** ${iso2Dictionary[iso2]} */\n`;

        const items = country.formats.reduce<(string | number)[]>(
          (acc, item) => {
            if (item.length > longestNumber) {
              longestNumber = item.length;
            }

            acc.push(item.length);

            const variable = formatsList[item.index];

            if (variable.repeatingTimes) {
              assertSafeFormat(variable.format);

              const variableName = formatVariableName(variable.format);

              formatsVariables.set(variableName, variable.format);

              _import += `${printNamedImport(
                [variableName],
                alias(CONSTANTS_FILE_PATH),
              )}\n\n`;

              acc.push(variableName);
            } else {
              assertSafeFormat(item.format);

              acc.push(`'${item.format}'`);
            }

            return acc;
          },
          [key, `'${country.iso2}'`],
        );

        if (item.length > 1 && !country.mainCountryForCode) {
          const leadingDigits =
            country.leadingDigits ||
            country.pattern.replace(/\\d(?:\{\d+\})?/g, '');

          assertSafePattern(leadingDigits);

          items.push(`/^(?:${leadingDigits})/`);
        }

        countries.add(iso2);

        const dataType = basename(
          PHONE_NUMBER_DATA_TYPE_FILE_PATH,
          extname(PHONE_NUMBER_DATA_TYPE_FILE_PATH),
        );

        await addFile(
          `${PHONE_NUMBER_FORMATS_FOLDER_PATH}/${iso2}/index.ts`,
          `${_import}${countryNameComment}${printArray(
            `const ${iso2}: ${dataType}`,
            items.map(String),
          )}\n\nexport default ${iso2};`,
        );

        await addFile(
          `${PHONE_NUMBER_VALIDATION_PATTERNS_FOLDER_PATH}/${iso2}/index.ts`,
          `${countryNameComment}${printAssignment(
            `const ${iso2}`,
            `/^(?:${country.pattern})$/`,
          )}\n\nexport default ${iso2};`,
        );
      }
    }

    // Nothing downstream reviews this - the commit lands on the base branch and
    // ships straight to npm - so refuse to write a dataset that looks wrong. These
    // bounds are deliberately loose: they catch upstream going missing or changing
    // shape, not ordinary metadata churn.
    const previousCountries = (
      await getFile(ISO2_TYPE_FILE_PATH, false, myRepo, baseBranch)
    )?.match(/'[A-Z]{2}'/g)?.length;

    if (countries.size < 200) {
      throw new Error(`only ${countries.size} countries were generated`);
    }

    if (previousCountries && countries.size < previousCountries - 5) {
      throw new Error(
        `countries dropped from ${previousCountries} to ${countries.size}`,
      );
    }

    if (skipped > 3) {
      throw new Error(`${skipped} countries had no formats`);
    }

    if (longestNumber < 7 || longestNumber > 20) {
      throw new Error(`implausible longest number: ${longestNumber}`);
    }

    if (longestCallingCode < 1 || longestCallingCode > 4) {
      throw new Error(
        `implausible longest calling code: ${longestCallingCode}`,
      );
    }

    info(
      `${countries.size} countries, longest number ${longestNumber}, longest calling code ${longestCallingCode}`,
    );

    if (countries.size) {
      const arr1 = Array.from(countries).sort();

      const phoneNumberValidationPatternsVariableName = basename(
        PHONE_NUMBER_VALIDATION_PATTERNS_FOLDER_PATH,
      );

      await addFile(
        `${PHONE_NUMBER_VALIDATION_PATTERNS_FOLDER_PATH}/index.ts`,
        `${arr1
          .map(iso2 =>
            printDefaultImport(
              iso2,
              `${alias(PHONE_NUMBER_VALIDATION_PATTERNS_FOLDER_PATH)}/${iso2}`,
            ),
          )
          .join('\n')}\n\n${printObject(
          `const ${phoneNumberValidationPatternsVariableName}`,
          arr1,
        )}\n\nexport default ${phoneNumberValidationPatternsVariableName};`,
      );

      const iso2TypeName = basename(
        ISO2_TYPE_FILE_PATH,
        extname(ISO2_TYPE_FILE_PATH),
      );

      await addFile(
        ISO2_TYPE_FILE_PATH,
        `${printUnion(
          iso2TypeName,
          arr1.map(item => `'${item}'`),
        )}\n\nexport default ${iso2TypeName};`,
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

      const phoneNumberUtilsVariableName = basename(
        PHONE_NUMBER_UTILS_FOLDER_PATH,
      );

      await addFile(
        `${PHONE_NUMBER_UTILS_FOLDER_PATH}/index.ts`,
        `${arr2
          .map(iso2 =>
            printDefaultImport(
              iso2,
              `${alias(PHONE_NUMBER_FORMATS_FOLDER_PATH)}/${iso2}`,
            ),
          )
          .join('\n')}\n\n${printDefaultImport(
          basename(CREATE_PHONE_NUMBER_UTILS_FOLDER_PATH),
          alias(CREATE_PHONE_NUMBER_UTILS_FOLDER_PATH),
        )}\n\n${printCallWithArray(
          `const ${phoneNumberUtilsVariableName}`,
          basename(CREATE_PHONE_NUMBER_UTILS_FOLDER_PATH),
          arr2,
        )}\n\nexport default ${phoneNumberUtilsVariableName};`,
      );
    }

    await addFile(
      CONSTANTS_FILE_PATH,
      [
        `${INTERNAL}export const MAX_CALLING_CODE_LENGTH = ${longestCallingCode};`,
        `${INTERNAL}export const MAX_NUMBER_LENGTH = ${longestNumber};`,
        `${INTERNAL}export const MASK_SYMBOL = '${MASK_SYMBOL}';`,
        // sorted by format so the file only changes when a format does, not when
        // the order countries happened to be visited in changes - the names are
        // content hashes, so they carry no useful order of their own
        ...Array.from(formatsVariables)
          .sort(([, a], [, b]) => (a < b ? -1 : 1))
          .map(
            ([name, format]) =>
              `${INTERNAL}export const ${name} = '${format}';`,
          ),
      ].join('\n\n'),
    );

    if (files.length) {
      const baseSHA = context.sha;

      // commits straight onto the base branch - the sync is fully automatic, so
      // there is no PR for anyone to review
      await octokit.git.updateRef({
        ...myRepo,
        ref: `heads/${baseBranch}`,
        sha: (
          await octokit.git.createCommit({
            ...myRepo,
            message: 'Metadata synchronization',
            tree: (
              await octokit.git.createTree({
                ...myRepo,
                tree: files,
                base_tree: baseSHA,
              })
            ).data.sha,
            parents: [baseSHA],
          })
        ).data.sha,
      });
    }

    // the caller releases only when something actually changed
    setOutput('updated', files.length);

    info(`updated ${files.length} files`);
  } catch (error) {
    setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
