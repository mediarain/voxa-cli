/* tslint:disable:no-console no-submodule-imports */
import * as _Promise from "bluebird";
import * as fsExtra from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { AlexaSchema } from "./AlexaSchema";
import { transform } from "./connectors/Spreadsheet";
import { DialogflowSchema } from "./DialogflowSchema";
import { downloadDirs } from "./Drive";
import { IFileContent } from "./Schema";
const fs = _Promise.promisifyAll(fsExtra);

export type ISupportedPlatforms = "alexa" | "dialogflow";

export interface IInteractionOptions {
  rootPath?: string;
  speechPath?: string;
  platforms?: ISupportedPlatforms[] | ISupportedPlatforms;
  contentPath?: string;
  viewsPath?: string;
  synonymPath?: string;
  spreadsheets: string | string[];
  assets?: string[];
  assetsPath?: string;
}

export interface IDefinedInteractionOptions {
  rootPath: string;
  speechPath: string;
  platforms: ISupportedPlatforms[];
  contentPath: string;
  viewsPath: string;
  synonymPath: string;
  spreadsheets: string[];
  assets: string[];
  assetsPath: string;
}

export const DEFAULT_INTERACTION_OPTIONS = {
  speechPath: "speech-assets",
  platforms: ["alexa"] as ISupportedPlatforms[],
  contentPath: "content",
  viewsPath: "/",
  synonymPath: "synonyms",
  assets: [],
  assetsPath: "assets"
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

  const platforms: ISupportedPlatforms[] = _.isString(interactionOptions.platforms)
    ? [interactionOptions.platforms]
    : interactionOptions.platforms || DEFAULT_INTERACTION_OPTIONS.platforms;

  const spreadsheets: string[] = _.isString(interactionOptions.spreadsheets)
    ? [interactionOptions.spreadsheets]
    : interactionOptions.spreadsheets;

  if (_.isEmpty(spreadsheets)) {
    throw Error("Spreadsheet were not specified in the right format");
  }

  return {
    rootPath,
    spreadsheets,
    speechPath,
    synonymPath,
    viewsPath,
    assetsPath,
    contentPath,
    platforms,
    assets
  };
}
export const buildInteraction = async (interactionOptions: IInteractionOptions, authKeys: any) => {
  const definedInteractionOptions = defaultOptions(interactionOptions);
  console.time("all");
  console.time("timeframe");
  const sheets = await transform(definedInteractionOptions, authKeys);
  console.timeEnd("timeframe");
  const platforms = definedInteractionOptions.platforms;
  const schemas = [];

  if (platforms.includes("alexa")) {
    const schema = new AlexaSchema(_.cloneDeep(sheets), definedInteractionOptions);
    schemas.push(schema);
    await fs.remove(
      path.join(
        definedInteractionOptions.rootPath,
        definedInteractionOptions.speechPath,
        schema.NAMESPACE
      )
    );
  }

  if (platforms.includes("dialogflow")) {
    const schema = new DialogflowSchema(_.cloneDeep(sheets), definedInteractionOptions);
    schemas.push(schema);
    await fs.remove(
      path.join(
        definedInteractionOptions.rootPath,
        definedInteractionOptions.speechPath,
        schema.NAMESPACE
      )
    );
  }

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

        schema.invocations.map(invoc => {
          schema.build(invoc.locale, invoc.environment);
        });
        acc = acc.concat(schema.fileContent);
        return acc;
      },
      [] as IFileContent[]
    )
    .map(file => fs.outputFile(file.path, JSON.stringify(file.content, null, 2), { flag: "w" }));

  await Promise.all(fileContentsProcess);
  await downloadDirs(
    definedInteractionOptions.assets,
    path.join(definedInteractionOptions.rootPath, definedInteractionOptions.assetsPath),
    authKeys
  );

  console.timeEnd("all");
};
