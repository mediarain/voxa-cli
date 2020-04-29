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
/* tslint:disable:no-empty no-submodule-imports */
import _ from "lodash";
import path from "path";
import uuid from "uuid/v5";
import { AGENT, BUILT_IN_INTENTS } from "./DialogflowDefault";
import { IFileContent, IIntent, Schema } from "./Schema";
import { IVoxaSheet } from "./VoxaSheet";

const NAMESPACE = "dialogflow";
// https://developers.google.com/actions/localization/languages-locales

const LOCALES = _([
  "en-US",
  "en-AU",
  "en-CA",
  "en-IN",
  "en-GB",
  "de-DE",
  "fr-FR",
  "fr-CA",
  "ja-JP",
  "ko-KR",
  "es-ES",
  "es-US",
  "es-MX",
  "pt-BR",
  "it-IT",
  "ru-RU",
  "hi-IN",
  "th-TH",
  "id-ID",
  "da-DK",
  "no-NO",
  "nl-NL",
  "sv-SE",
  "ko-KR",
  "ru-RU",
  "hi-IN",
  "th-TH",
  "id-ID"
])
  .uniq()
  .value();

const LANG_BUT_LOCALE = _(LOCALES)
  .map(item => item.split("-")[0]) // es, en, du etc.
  .uniq()
  .value();

const AVAILABLE_LOCALES = LANG_BUT_LOCALE.concat(LOCALES);

export interface IDialogflowMessage {
  type: number;
  lang: string;
  speech: string[];
}

export class DialogflowSchema extends Schema {
  public environment = "staging";
  public builtIntents = [] as any;

  constructor(voxaSheets: IVoxaSheet[], interactionOptions: any) {
    super(NAMESPACE, AVAILABLE_LOCALES, voxaSheets, interactionOptions);
  }

  public validate() {}

  public build(locale: string, environment: string) {
    this.buildIntent(locale, environment);
    this.buildUtterances(locale, environment);
    this.buildEntities(locale, environment);
    this.buildPackage(environment);
    this.buildAgent(locale, environment);
  }

  public buildPackage(environment: string) {
    const file: IFileContent = {
      path: this.buildFilePath(environment, "package.json"),
      content: {
        version: "1.0.0"
      }
    };
    this.fileContent.push(file);
  }

  public getLocale(locale: string) {
    locale = locale.toLowerCase();
    const localesNotAttachedToParentLang = ["pt-br"];

    if (
      this.interactionOptions.ignoreDialogflowParentLocale ||
      localesNotAttachedToParentLang.find(item => locale === item)
    ) {
      return locale;
    }

    return locale.split("-")[0];
  }

  public buildAgent(locale: string, environment: string) {
    const intents = this.builtIntents;
    const invocation = _.find(this.invocations, { locale, environment });
    const invocationName = _.get(invocation, "name", "Skill with no name");
    const intentsByPlatformAndEnvironments = this.intentsByPlatformAndEnvironments(
      locale,
      environment
    );

    const startIntents = _(intentsByPlatformAndEnvironments)
      .filter({ startIntent: true })
      .map(intent => {
        const startIntent = findIntent(intent.name, intents);

        if (startIntent) {
          return {
            intentId: _.get(startIntent, "id"),
            signInRequired: !!_.get(startIntent, "signInRequired")
          };
        }
      })
      .compact()
      .value();

    const endIntentIds = _(intentsByPlatformAndEnvironments)
      .filter({ endIntent: true })
      .map(intent => {
        const filteredIntent = findIntent(intent.name, intents);
        return _.get(filteredIntent, "id");
      })
      .compact()
      .value();

    const supportedLanguages = _(this.invocations)
      .filter({ environment })
      .map("locale")
      .uniq()
      .value();

    const language = this.getLocale(locale);

    const agent = _.merge(
      _.cloneDeep(AGENT),
      _.cloneDeep(this.mergeManifest(environment)),
      _.cloneDeep({
        description: invocationName,
        language,
        supportedLanguages,
        googleAssistant: { project: _.kebabCase(invocationName), startIntents, endIntentIds }
      })
    );

    const file: IFileContent = {
      path: this.buildFilePath(environment, "agent.json"),
      content: agent
    };
    this.fileContent.push(file);
  }

  public buildUtterances(locale: string, environment: string) {
    const intentsByPlatformAndEnvironments = this.intentsByPlatformAndEnvironments(
      locale,
      environment
    );

    locale = this.getLocale(locale);
    intentsByPlatformAndEnvironments.map((rawIntent: IIntent) => {
      let { name, samples, events } = rawIntent;
      const { slotsDefinition } = rawIntent;
      name = name.replace("AMAZON.", "");

      const builtInIntentSamples = _.get(BUILT_IN_INTENTS, name, []);
      samples = _(samples)
        .concat(builtInIntentSamples)
        .uniq()
        .value();

      events = name === "LaunchIntent" ? ["WELCOME", "GOOGLE_ASSISTANT_WELCOME"] : events;
      events = (events as string[]).map((eventName: string) => ({ name: eventName }));

      const parameters = _(slotsDefinition)
        .filter(slot => this.filterByPlatform(slot))
        .map(slot => ({
          dataType: _.includes(slot.type, "@sys.") ? slot.type : `@${slot.type}`,
          name: slot.name,
          value: `$${slot.name}`,
          isList: false,
          required: slot.required
        }))
        .value();

      const resultSamples = samples.map(sample => {
        const data = _.chain(sample)
          .replace(/{([^}]+)}/g, (match, inner) => {
            return `|{${inner}}|`;
          })
          .split("|")
          .map(text => {
            const element = {};
            const isTemplate = _.includes(text, "{") && _.includes(text, "}");

            const alias = text.replace("{", "").replace("}", "");

            const slot = _.find(parameters, { name: text });

            if (isTemplate && slot) {
              const slotMeta = slot.dataType.includes("@sys.")
                ? slot.dataType
                : `@${_.kebabCase(slot.dataType)}`;
              _.set(element, "meta", slotMeta);
              _.set(element, "alias", alias);
            }

            if (!_.isEmpty(text)) {
              _.set(element, "text", text);
              _.set(element, "userDefined", isTemplate);
            }

            _.set(element, "id", hashObj(element));

            return _.isEmpty(_.omit(element, ["id"])) ? null : element;
          })
          .compact()
          .value();

        return {
          data,
          isTemplate: false,
          count: 0,
          updated: 0
        };
      });

      if (!_.isEmpty(resultSamples)) {
        const file: IFileContent = {
          path: this.buildFilePath(environment, "intents", `${name}_usersays_${locale}.json`),
          content: resultSamples
        };
        this.fileContent.push(file);
      }
    });
  }
  public buildIntent(locale: string, environment: string) {
    const intentsByPlatformAndEnvironments = this.intentsByPlatformAndEnvironments(
      locale,
      environment
    );

    locale = this.getLocale(locale);
    this.builtIntents = intentsByPlatformAndEnvironments.map((rawIntent: IIntent) => {
      let { name, events } = rawIntent;
      const { parameterName, parameterValue } = rawIntent;
      const { webhookForSlotFilling, slotsDefinition, responses, webhookUsed } = rawIntent;
      name = name.replace("AMAZON.", "");
      const fallbackIntent = name === "FallbackIntent";
      const action = fallbackIntent ? "input.unknown" : name;

      events = name === "LaunchIntent" ? ["WELCOME", "GOOGLE_ASSISTANT_WELCOME"] : events;
      events = (events as string[]).map((eventName: string) => ({ name: eventName }));

      // tslint:disable-next-line: prefer-const
      let parameters = _(slotsDefinition)
        .filter(slot => this.filterByPlatform(slot))
        .map(slot => ({
          dataType: _.includes(slot.type, "@sys.") ? slot.type : `@${_.kebabCase(slot.type)}`,
          name: slot.name.replace("{", "").replace("}", ""),
          value: `$${slot.name.replace("{", "").replace("}", "")}`,
          isList: false,
          required: slot.required
        }))
        .value();

      if (parameterName && parameterValue) {
        parameters.push({
          dataType: "",
          name: parameterName,
          value: parameterValue,
          isList: false,
          required: false
        });
      }

      const messages = [];
      if (responses.length > 0) {
        messages.push({
          type: 0,
          lang: locale,
          speech: responses
        });
      }

      const intent = {
        name,
        auto: true,
        contexts: [],
        responses: [
          {
            resetContexts: false,
            action,
            affectedContexts: [],
            parameters,
            messages,
            defaultResponsePlatforms: {},
            speech: []
          }
        ],
        priority: 500000,
        webhookUsed,
        webhookForSlotFilling,
        fallbackIntent,
        events
      };

      _.set(intent, "id", hashObj(intent));
      const file: IFileContent = {
        path: this.buildFilePath(environment, "intents", `${intent.name}.json`),
        content: intent
      };
      this.fileContent.push(file);
      return intent;
    });
  }

  public buildEntities(locale: string, environment: string) {
    const localeEntity = this.getLocale(locale);

    this.getSlotsByIntentsDefinition(locale, environment)
      .filter(slot => !_.includes(slot.name, "@sys."))
      .forEach(rawSlot => {
        const { name, values } = rawSlot;
        const slotName = _.kebabCase(name);
        const slotContent = {
          name: slotName,
          isOverridable: true,
          isEnum: false,
          automatedExpansion: false
        };
        _.set(slotContent, "id", hashObj(slotContent));

        const fileDef: IFileContent = {
          path: this.buildFilePath(environment, "entities", `${slotName}.json`),
          content: slotContent
        };

        const fileValue: IFileContent = {
          path: this.buildFilePath(
            environment,
            "entities",
            `${slotName}_entries_${localeEntity}.json`
          ),
          content: values
        };

        this.fileContent.push(fileDef, fileValue);
      });
  }

  protected buildFilePath(...names: string[]): string {
    return super.buildFilePath(this.interactionOptions.speechPath, this.NAMESPACE, ...names);
  }
}

function hashObj(obj: {}) {
  return uuid(JSON.stringify(obj), uuid.DNS);
}

function findIntent(name: string, intents: IIntent[]): IIntent | undefined {
  const intentName = name.replace("AMAZON.", "");
  return _.find(intents, i => i.name === name || i.name === intentName);
}
