/*
 * Copyright (c) 2018 Rain Agency <contact@rain.agency>
 * Author: Rain Agency <contact@rain.agency>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
/* tslint:disable:no-console no-submodule-imports */
import fsExtra from "fs-extra";
import _ from "lodash";
import path from "path";
import { AlexaSchema } from "./AlexaSchema";
import { transform } from "./connectors/Spreadsheet";
import { DialogflowSchema } from "./DialogflowSchema";
import { downloadDirs } from "./Drive";
import { IFileContent, IInvocation, Schema } from "./Schema";
import { IPlatformSheets, IVoxaSheet } from "./VoxaSheet";
const fs = Promise.promisifyAll(fsExtra);

export type ISupportedPlatforms = "alexa" | "dialogflow";

export interface IInteractionOptions {
  rootPath?: string;
  speechPath?: string;
  platforms?: ISupportedPlatforms[] | ISupportedPlatforms;
  contentPath?: string;
  viewsPath?: string;
  synonymPath?: string;
  spreadsheets: string | string[];
  alexaSpreadsheets: string | string[];
  dialogflowSpreadsheets: string | string[];
  assets?: string[];
  assetsPath?: string;
  ignoreDialogflowParentLocale?: boolean;
}

export interface IDefinedInteractionOptions {
  rootPath: string;
  speechPath: string;
  platforms: ISupportedPlatforms[];
  contentPath: string;
  viewsPath: string;
  synonymPath: string;
  spreadsheets: string[];
  alexaSpreadsheets: string | string[];
  dialogflowSpreadsheets: string | string[];
  assets: string[];
  assetsPath: string;
  ignoreDialogflowParentLocale: boolean;
}

export const DEFAULT_INTERACTION_OPTIONS = {
  speechPath: "speech-assets",
  platforms: ["alexa"] as ISupportedPlatforms[],
  contentPath: "content",
  viewsPath: "/",
  synonymPath: "synonyms",
  assets: [],
  assetsPath: "assets",
  ignoreDialogflowParentLocale: false
};

function defaultOptions(interactionOptions: IInteractionOptions): IDefinedInteractionOptions {
  const rootPath: string = interactionOptions.rootPath || "";
  const speechPath: string =
    interactionOptions.speechPath || DEFAULT_INTERACTION_OPTIONS.speechPath;
  const synonymPath: string =
    interactionOptions.synonymPath || DEFAULT_INTERACTION_OPTIONS.synonymPath;
  const viewsPath: string = interactionOptions.viewsPath || DEFAULT_INTERACTION_OPTIONS.viewsPath;
  const contentPath: string =
    interactionOptions.contentPath || DEFAULT_INTERACTION_OPTIONS.contentPath;
  const assetsPath: string =
    interactionOptions.assetsPath || DEFAULT_INTERACTION_OPTIONS.assetsPath;

  const assets: string[] = interactionOptions.assets || DEFAULT_INTERACTION_OPTIONS.assets;

  const ignoreDialogflowParentLocale: boolean =
    interactionOptions.ignoreDialogflowParentLocale ||
    DEFAULT_INTERACTION_OPTIONS.ignoreDialogflowParentLocale;

  const spreadsheets: string[] = arrayify(interactionOptions.spreadsheets) as string[];

  const alexaSpreadsheets: string[] = arrayify(interactionOptions.alexaSpreadsheets) as string[];

  const dialogflowSpreadsheets: string[] = arrayify(
    interactionOptions.dialogflowSpreadsheets
  ) as string[];

  let platforms: ISupportedPlatforms[] = arrayify(
    interactionOptions.platforms
  ) as ISupportedPlatforms[];

  const spreadsheetMapping = {
    alexa: alexaSpreadsheets,
    dialogflow: dialogflowSpreadsheets
  };

  // If the user didn't declare anything in the platorm key,
  // then we should inspect the spreadshseet in alexaSpreadsheets and dialogflowSpreadsheets
  // to find out what platform the user wants to use.

  platforms = _.chain(spreadsheetMapping)
    .toPairs()
    .reduce(
      (acc: string[], next: any[]) => {
        const key = next[0];
        const value = next[1];
        if (value) {
          acc.push(key);
        }
        return acc;
      },
      [] as ISupportedPlatforms[]
    )
    .concat(platforms)
    .filter()
    .uniq()
    .value() as ISupportedPlatforms[];

  if (_.isEmpty(spreadsheets) && _.isEmpty(platforms)) {
    throw Error("Spreadsheet were not specified in the right format");
  }

  platforms = _.isEmpty(platforms) ? DEFAULT_INTERACTION_OPTIONS.platforms : platforms;

  return {
    rootPath,
    spreadsheets,
    alexaSpreadsheets,
    dialogflowSpreadsheets,
    speechPath,
    synonymPath,
    viewsPath,
    assetsPath,
    contentPath,
    platforms,
    assets,
    ignoreDialogflowParentLocale
  };
}

function arrayify(value: string | any[] | undefined): any[] | undefined {
  return _.isString(value) ? [value] : value;
}

async function getSheetsByPlatform(
  interactionOptions: IInteractionOptions,
  authKeys: any
): Promise<IPlatformSheets> {
  const sheets = await transform(interactionOptions, authKeys);

  const AVAILABLE_PLATFORM_KEYS = ["alexaSpreadsheets", "dialogflowSpreadsheets"];
  const transformByPlatfromPromises = AVAILABLE_PLATFORM_KEYS.map(spreadsheetKey =>
    transform(interactionOptions, authKeys, spreadsheetKey)
  );

  const sheetsByPlatformPromise: IVoxaSheet[][] = await Promise.all(transformByPlatfromPromises);
  const sheetsByPlatform: IPlatformSheets = AVAILABLE_PLATFORM_KEYS.reduce((acc, next, index) => {
    const sheetByPlatform = _.chain(sheets)
      .cloneDeep()
      .concat(sheetsByPlatformPromise[index])
      .uniq()
      .value();

    _.set(acc, next, sheetByPlatform);
    return acc;
  }, {}) as IPlatformSheets; // concat all the sheets from the `spreadsheets` key with platform specific sheets

  return sheetsByPlatform;
}
export const buildInteraction = async (interactionOptions: IInteractionOptions, authKeys: any) => {
  const definedInteractionOptions = defaultOptions(interactionOptions);
  console.time("all");
  console.time("timeframe");

  const { alexaSpreadsheets, dialogflowSpreadsheets } = await getSheetsByPlatform(
    definedInteractionOptions,
    authKeys
  );

  console.timeEnd("timeframe");
  const platforms = definedInteractionOptions.platforms;
  const schemas = [];

  if (platforms.includes("alexa")) {
    const schema = new AlexaSchema(alexaSpreadsheets, definedInteractionOptions);
    schemas.push(schema);
  }

  if (platforms.includes("dialogflow")) {
    const schema = new DialogflowSchema(dialogflowSpreadsheets, definedInteractionOptions);
    schemas.push(schema);
  }

  await Promise.all(
    schemas.map(schema =>
      fs.remove(
        path.join(
          definedInteractionOptions.rootPath,
          definedInteractionOptions.speechPath,
          schema.NAMESPACE
        )
      )
    )
  );

  const fileContentsProcess = schemas
    .reduce(
      (acc, schema, index) => {
        if (index === 0) {
          // We only want to execute this file once
          schema.buildDownloads();
          schema.buildViews();
          schema.buildViewsMapping();
          schema.buildSynonyms();
        }

        schema.invocations.map((invoc: IInvocation) => {
          schema.build(invoc.locale, invoc.environment);
        });
        acc = acc.concat(schema.fileContent);
        return acc;
      },
      [] as IFileContent[]
    )
    .map((file: IFileContent) =>
      fs.outputFile(file.path, JSON.stringify(file.content, null, 2), { flag: "w" })
    );

  await Promise.all(fileContentsProcess);
  await downloadDirs(
    definedInteractionOptions.assets,
    path.join(definedInteractionOptions.rootPath, definedInteractionOptions.assetsPath),
    authKeys
  );

  console.timeEnd("all");
};
