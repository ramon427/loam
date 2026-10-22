import { describeNotesHostConformance } from "@loam/shared/bridge/notesHostConformance";
import { createTestStore } from "@loam/storage/testing/storeFixtures";

import { createTestApp } from "./appFixture";

describeNotesHostConformance("Loam's main process", async () => {
  const { dispatch } = await createTestApp(await createTestStore());
  return { invoke: (method, params) => dispatch(method, params, "window") };
});
