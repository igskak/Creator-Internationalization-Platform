import { INTROS, independentVersion } from "../independent";
import v2 from "./v2";

// content-writer@3: content-writer@2 without the name of the source brand (independent market accounts, see
// ../independent.ts). A released version file is never edited: change it in v4.ts.

export default independentVersion(v2, INTROS.content);
