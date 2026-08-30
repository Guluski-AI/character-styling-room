import { createServices } from "../create-services.mjs";

const services = createServices();
const result = await services.model.healthCheck();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
