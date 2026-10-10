import { INTROS, independentVersion } from "../independent";
import v1 from "./v1";

// post-annotator@2: post-annotator@1 without the name of the source brand (independent market accounts, see
// ../independent.ts). A released version file is never edited: change it in v3.ts.

export default independentVersion(v1, INTROS.contentTool);
