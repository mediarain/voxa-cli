import * as mime from "alexa-mime";
import * as _ from "lodash";
import * as nock from "nock";
import * as path from "path";
import * as simple from "simple-mock";
import * as skill from "../src/app";
import * as views from "../src/app/views.json";


const describeWrapper = {
  clear: () => {
    simple.restore();
    nock.cleanAll();
  }
};

mime(
  skill,
  views.en.translation,
  path.join(__dirname, "use-cases"),
  path.join(__dirname, "..", "reports", "simulate"),
  describeWrapper
);
