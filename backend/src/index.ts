import { createApp } from "./app";
import { installFirestoreUsageCounter } from "./utils/firestoreUsage";
import { env } from "./config/env";

installFirestoreUsageCounter();
const app = createApp();

app.listen(env.port, () => {
  console.log(`fincae backend listening on http://localhost:${env.port}`);
});
